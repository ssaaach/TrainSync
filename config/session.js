// express-session middleware backed by the MySQL `sessions` table.
const crypto = require('crypto');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const config = require('./index');
const pool = require('./db');

function resolveSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  if (config.isProduction) {
    throw new Error('SESSION_SECRET must be set in production (see .env.example)');
  }
  console.warn('⚠️  SESSION_SECRET is not set; using a random secret (sessions reset on restart).');
  return crypto.randomBytes(32).toString('hex');
}

const store = new MySQLStore({ createDatabaseTable: true }, pool);

const sessionMiddleware = session({
  name: config.session.cookieName,
  secret: resolveSecret(),
  store,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: config.session.maxAgeMs,
  },
});

// Options clearCookie needs so the browser actually drops the cookie.
const cookieClearOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
};

module.exports = { sessionMiddleware, store, cookieClearOptions };
