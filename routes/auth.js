// /api/auth/*
const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../config/db');
const config = require('../config');
const { cookieClearOptions } = require('../config/session');
const { validate } = require('../middleware/validate');
const { generateToken } = require('../middleware/csrf');
const { ipLimiter, loginThrottle } = require('../middleware/rateLimit');
const { normalizeRole } = require('../services/normalize');

const router = express.Router();
const A = config.auth;

const email = z.string().trim().toLowerCase()
  .max(A.emailMaxLength, `Email must be at most ${A.emailMaxLength} characters`)
  .pipe(z.email({ message: 'Enter a valid email address' }));

// bcrypt only uses the first 72 bytes, so longer passwords are rejected
// instead of being silently truncated.
const newPassword = z.string()
  .min(A.passwordMinLength, `Password must be at least ${A.passwordMinLength} characters`)
  .refine(p => Buffer.byteLength(p, 'utf8') <= A.passwordMaxBytes,
    `Password must be at most ${A.passwordMaxBytes} bytes`);

const registerSchema = z.object({
  email,
  name: z.string().trim().min(1, 'Name is required').max(100),
  role: z.string().transform(normalizeRole).refine(Boolean, { message: 'Role must be "trainer" or "trainee"' }),
  password: newPassword,
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(1000),
});

// Compared against when the email is unknown, so both failure paths cost one
// bcrypt compare and response time doesn't reveal which accounts exist.
let dummyHash;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('timing-equaliser', A.bcryptRounds));

function sessionUser(row) {
  return { user_id: row.user_id, email: row.email, role: row.role, name: row.name, onboardingComplete: row.onboarding_complete === 1 };
}

// Starts a fresh session (new id: prevents fixation) for this user.
function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.user = sessionUser(user);
      req.session.loginAt = Date.now();
      const csrfToken = generateToken(req, true);
      req.session.save(saveErr => (saveErr ? reject(saveErr) : resolve(csrfToken)));
    });
  });
}

router.get('/csrf', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ csrfToken: generateToken(req) });
});

router.post('/register', ipLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  const { email: userEmail, name, role, password } = req.valid.body;
  try {
    const hashed = await bcrypt.hash(password, A.bcryptRounds);
    const userId = await db.withTransaction(async conn => {
      const [result] = await conn.execute(
        'INSERT INTO users (email, name, role, password) VALUES (?, ?, ?, ?)',
        [userEmail, name, role, hashed]
      );
      const table = role === 'trainer' ? 'trainers' : 'trainees';
      await conn.execute(`INSERT INTO ${table} (user_id) VALUES (?)`, [result.insertId]);
      return result.insertId;
    });
    // Signed straight in; onboarding (consent first) comes next.
    const csrfToken = await establishSession(req, { user_id: userId, email: userEmail, role, name, onboarding_complete: 0 });
    res.status(201).json({ message: 'User registered successfully', csrfToken, next: '/onboarding.html' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already registered', code: 'email_taken' });
    next(err);
  }
});

router.post('/login', validate({ body: loginSchema }), loginThrottle, async (req, res, next) => {
  const { email: userEmail, password } = req.valid.body;
  try {
    const [rows] = await db.execute(
      'SELECT user_id, email, name, role, password, onboarding_complete FROM users WHERE email = ?', [userEmail]
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password : await getDummyHash());
    if (!user || !ok) {
      await req.recordLoginFailure();
      return res.status(400).json({ error: 'Invalid email or password', code: 'invalid_credentials' });
    }
    const csrfToken = await establishSession(req, user);
    // Activity timestamp is best-effort; it must not slow down or fail a login.
    db.execute('UPDATE users SET last_active_at = NOW() WHERE user_id = ?', [user.user_id])
      .catch(err => req.log.warn({ err: err.message }, 'last_active_at update failed'));
    res.json({ message: 'Login successful', user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  const clear = () => {
    for (const name of [config.session.cookieName, ...config.session.legacyCookieNames]) {
      res.clearCookie(name, cookieClearOptions);
    }
    res.json({ message: 'Logged out successfully' });
  };
  if (!req.session) return clear();
  req.session.destroy(err => (err ? next(err) : clear()));
});

router.get('/session', (req, res) => {
  const user = req.session && req.session.user;
  res.set('Cache-Control', 'no-store');
  if (!user || !user.user_id) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, ...user });
});

module.exports = router;
module.exports.establishSession = establishSession;
