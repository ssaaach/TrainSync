// /api/auth/* (also mounted at legacy /auth/*)
const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../config/db');
const config = require('../config');
const { cookieClearOptions } = require('../config/session');
const { validate } = require('../middleware/validate');
const { normalizeRole } = require('../services/normalize');

const router = express.Router();

const email = z.string().trim().toLowerCase().pipe(z.email({ message: 'Enter a valid email address' }));

const registerSchema = z.object({
  email,
  name: z.string().trim().min(1, 'Name is required').max(100),
  role: z.string().transform(normalizeRole).refine(Boolean, { message: 'Role must be "trainer" or "trainee"' }),
  password: z.string().min(config.auth.passwordMinLength,
    `Password must be at least ${config.auth.passwordMinLength} characters`).max(200),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

function sessionUser(row) {
  return { user_id: row.user_id, email: row.email, role: row.role, name: row.name };
}

router.post('/register', validate({ body: registerSchema }), async (req, res, next) => {
  const { email: userEmail, name, role, password } = req.valid.body;
  try {
    const hashed = await bcrypt.hash(password, config.auth.bcryptRounds);
    await db.withTransaction(async conn => {
      const [result] = await conn.execute(
        'INSERT INTO users (email, name, role, password) VALUES (?, ?, ?, ?)',
        [userEmail, name, role, hashed]
      );
      const table = role === 'trainer' ? 'trainers' : 'trainees';
      await conn.execute(`INSERT INTO ${table} (user_id) VALUES (?)`, [result.insertId]);
    });
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already registered' });
    next(err);
  }
});

router.post('/login', validate({ body: loginSchema }), async (req, res, next) => {
  const { email: userEmail, password } = req.valid.body;
  try {
    const [rows] = await db.execute(
      'SELECT user_id, email, name, role, password FROM users WHERE email = ?', [userEmail]
    );
    const user = rows[0];
    // Same message for unknown email and wrong password (no account enumeration).
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    // New session id on login prevents session fixation.
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = sessionUser(user);
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.json({ message: 'Login successful', user: req.session.user });
      });
    });
  } catch (err) {
    next(err);
  }
});

function logout(req, res, next) {
  const clear = () => {
    for (const name of [config.session.cookieName, ...config.session.legacyCookieNames]) {
      res.clearCookie(name, cookieClearOptions);
    }
    res.json({ message: 'Logged out successfully' });
  };
  if (!req.session) return clear();
  req.session.destroy(err => (err ? next(err) : clear()));
}

router.post('/logout', logout);
router.get('/logout', logout); // backward compatibility

function session(req, res) {
  const user = req.session && req.session.user;
  if (!user || !user.user_id) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, ...user, id: user.user_id });
}

router.get('/session', session);
router.post('/session', session); // backward compatibility

module.exports = router;
