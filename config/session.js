// express-session backed by the MySQL `sessions` table.
//   idle timeout      rolling cookie maxAge (renewed on each request)
//   absolute timeout  enforced by enforceAbsoluteTimeout from the login time
const crypto = require('crypto');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const config = require('./index');
const db = require('./db');
const logger = require('./logger');

function resolveSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  // config/env.js already refuses to start production without a secret.
  if (!config.isTest) logger.warn('SESSION_SECRET is not set; using a random secret (sessions reset on restart).');
  return crypto.randomBytes(32).toString('hex');
}

const store = new MySQLStore({
  createDatabaseTable: true,
  clearExpired: !config.isServerless,
  checkExpirationInterval: 15 * 60 * 1000,
}, db.pool);

const cookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
  maxAge: config.session.idleTimeoutMs,
};

const sessionMiddleware = session({
  name: config.session.cookieName,
  secret: resolveSecret(),
  store,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: config.isProduction,
  cookie,
});

// Logs the user out once the absolute session lifetime since login has passed.
function enforceAbsoluteTimeout(req, res, next) {
  const s = req.session;
  if (s && s.user && s.loginAt && Date.now() - s.loginAt > config.session.absoluteTimeoutMs) {
    delete s.user;
    delete s.loginAt;
  }
  next();
}

// Options clearCookie needs so the browser actually drops the cookie.
const cookieClearOptions = { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProduction };

module.exports = { sessionMiddleware, enforceAbsoluteTimeout, store, cookieClearOptions };
