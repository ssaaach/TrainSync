// Synchronizer-token CSRF protection (csrf-sync). The token lives in the
// session; clients read it from GET /api/auth/csrf and send it back in the
// x-csrf-token header on every POST/PUT/PATCH/DELETE. Cron endpoints are
// exempt: they authenticate with a bearer secret instead of a cookie.
const { csrfSync } = require('csrf-sync');

const { csrfSynchronisedProtection, generateToken } = csrfSync({
  size: 32,
  getTokenFromRequest: req => req.headers['x-csrf-token'],
  skipCsrfProtection: req => req.path.startsWith('/cron/'),
});

module.exports = { csrfProtection: csrfSynchronisedProtection, generateToken };
