// Credential-route throttling, stored in MySQL so every process shares it.
//   ipLimiter      every registration attempt per client IP (express-rate-limit)
//   loginThrottle  *failed* logins, per client IP and per email (in tiers, e.g.
//                  5 per 15 min and 20 per day). Unknown emails are tracked too,
//                  so a lockout doesn't reveal which accounts exist. Counting
//                  failures only keeps shared networks (campus/office NAT)
//                  usable, and a successful login costs one SELECT, no writes.
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../config/db');
const { MySqlRateLimitStore } = require('../services/rateLimitStore');

const RL = config.auth.rateLimit;
const LF = RL.loginFailures;

const minutesUntil = reset => Math.max(1, Math.ceil((new Date(reset).getTime() - Date.now()) / 60_000));

function tooMany(res, req, message, code, reset) {
  const mins = reset ? minutesUntil(reset) : null;
  res.status(429).json({
    error: `${message}${mins ? ` Try again in ${mins} minute${mins === 1 ? '' : 's'}.` : ''}`,
    code,
    requestId: req.id,
  });
}

const ipLimiter = rateLimit({
  windowMs: RL.ip.windowMs,
  limit: RL.ip.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: new MySqlRateLimitStore({ prefix: 'ip:' }),
  handler: (req, res) => tooMany(res, req, 'Too many attempts from your network.', 'rate_limited', req.rateLimit && req.rateLimit.resetTime),
});

const emailKey = req => {
  const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email.slice(0, 150) || '(none)';
};

// [{ key, max, windowMs, message, code }] for this request.
function loginTiers(req) {
  const email = emailKey(req);
  return [
    { key: `lfip:${req.ip}`, ...LF.ip, message: 'Too many failed sign-in attempts from your network.', code: 'rate_limited' },
    ...LF.account.map((t, i) => ({
      key: `acct${i}:${email}`, ...t, message: 'Too many failed sign-in attempts for this account.', code: 'account_locked',
    })),
  ].map(t => ({ ...t, key: t.key.slice(0, 191) }));
}

// Blocks throttled IPs/accounts; gives the route req.recordLoginFailure().
async function loginThrottle(req, res, next) {
  const tiers = loginTiers(req);
  try {
    const [rows] = await db.query(
      'SELECT rl_key, hits, reset_at FROM rate_limit_hits WHERE rl_key IN (?) AND reset_at > NOW(3)', [tiers.map(t => t.key)]
    );
    const byKey = new Map(rows.map(r => [r.rl_key, r]));
    for (const t of tiers) {
      const row = byKey.get(t.key);
      if (row && row.hits >= t.max) return tooMany(res, req, t.message, t.code, row.reset_at);
    }
    req.recordLoginFailure = () => recordFailure(tiers);
    next();
  } catch (err) {
    next(err);
  }
}

// One upsert bumps every tier; an elapsed window restarts at 1.
async function recordFailure(tiers) {
  const values = tiers.map(() => '(?, 1, NOW(3) + INTERVAL ? MICROSECOND)').join(', ');
  await db.execute(
    `INSERT INTO rate_limit_hits (rl_key, hits, reset_at) VALUES ${values} AS n
     ON DUPLICATE KEY UPDATE
       hits = IF(rate_limit_hits.reset_at <= NOW(3), 1, rate_limit_hits.hits + 1),
       reset_at = IF(rate_limit_hits.reset_at <= NOW(3), n.reset_at, rate_limit_hits.reset_at)`,
    tiers.flatMap(t => [t.key, t.windowMs * 1000])
  );
}

module.exports = { ipLimiter, loginThrottle, emailKey };
