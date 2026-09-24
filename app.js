// Builds the Express app (no listen) so it can be mounted by server.js, the
// Vercel function (api/index.js) and Supertest.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./config/logger');
const { sessionMiddleware, enforceAbsoluteTimeout } = require('./config/session');
const { csrfProtection } = require('./middleware/csrf');
const { apiNotFound, errorHandler } = require('./middleware/errors');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const workoutRoutes = require('./routes/workouts');
const dietRoutes = require('./routes/diets');
const gymRoutes = require('./routes/gyms');

const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

// Request id: honour an upstream id (Vercel/NGINX) if it looks sane.
function requestId(req, res) {
  const incoming = req.headers['x-request-id'] || req.headers['x-vercel-id'];
  const id = typeof incoming === 'string' && /^[\w.:-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

app.use(pinoHttp({
  logger,
  genReqId: requestId,
  autoLogging: { ignore: req => !req.url.startsWith('/api/') },
  customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  serializers: {
    req: req => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
    res: res => ({ statusCode: res.statusCode }),
  },
}));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: config.csp.scriptSrc,
      styleSrc: config.csp.styleSrc,
      imgSrc: config.csp.imgSrc,
      connectSrc: config.csp.connectSrc,
      mediaSrc: config.csp.mediaSrc,
      fontSrc: config.csp.fontSrc,
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: config.isProduction ? [] : null,
    },
  },
  strictTransportSecurity: config.isProduction,
}));

if (config.corsOrigins.length) {
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
}

// Health probes and static files never need the session (no DB round trip).
app.use(healthRoutes);
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'homepage.html')));
app.use(express.static(PUBLIC_DIR, {
  index: false,
  setHeaders(res, file) {
    if (/\.(woff2|mp4|webm|jpg|jpeg|png|webp|svg|ico)$/i.test(file)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  },
}));

app.use(express.json({ limit: '100kb' }));
app.use(sessionMiddleware);
app.use(enforceAbsoluteTimeout);

app.get('/home', (req, res) => {
  if (req.session && req.session.user) return res.sendFile(path.join(PUBLIC_DIR, 'homepage1.html'));
  res.redirect('/login.html');
});

// API (CSRF-protected for every state-changing method)
app.use('/api', csrfProtection);
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/workouts', workoutRoutes);
app.use('/api/diets', dietRoutes);
app.use('/api/gyms', gymRoutes);
app.use('/api/stats', require('./routes/stats'));
app.use('/api/cron', require('./routes/cron'));
app.use('/api', apiNotFound);

app.use(errorHandler);

module.exports = app;
