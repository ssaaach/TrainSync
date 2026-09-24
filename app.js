// Builds the Express app (no listen) so tests can mount it with Supertest.
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { sessionMiddleware } = require('./config/session');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const workoutRoutes = require('./routes/workouts');
const dietRoutes = require('./routes/diets');
const gymRoutes = require('./routes/gyms');

const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.set('trust proxy', config.server.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: config.csp.scriptSrc,
      styleSrc: config.csp.styleSrc,
      imgSrc: config.csp.imgSrc,
      connectSrc: config.csp.connectSrc,
      mediaSrc: config.csp.mediaSrc,
      upgradeInsecureRequests: config.isProduction ? [] : null,
    },
  },
  strictTransportSecurity: config.isProduction,
}));

// Allows the VS Code Live Server workflow (pages on :5500 calling the API on :5000).
app.use(cors({ origin: config.server.corsOrigins, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

if (!config.isTest) {
  // Method, path and status only: request bodies can contain passwords.
  app.use((req, res, next) => {
    res.on('finish', () => {
      const url = req.originalUrl.split('?')[0];
      if (url.startsWith('/api/') || url.startsWith('/auth/')) {
        console.log(`${req.method} ${url} → ${res.statusCode}`);
      }
    });
    next();
  });
}

app.use(sessionMiddleware);

const authLimiter = rateLimit({
  windowMs: config.auth.rateLimit.windowMs,
  limit: config.auth.rateLimit.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Pages poll the session endpoint on every load; only throttle credential routes.
  skip: req => req.path === '/session',
  message: { error: 'Too many attempts. Please try again later.' },
});

// API
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/workouts', workoutRoutes);
app.use('/api/diets', dietRoutes);
app.use('/api/gyms', gymRoutes);

// Legacy aliases (pre-v2 URLs) so nothing breaks mid-migration.
app.post('/auth/update-profile', ...profileRoutes.legacyUpdate);
app.use('/auth/workouts', workoutRoutes);
app.use('/auth/diets', dietRoutes);
app.use('/auth/gyms', gymRoutes);
app.use('/auth', authLimiter, authRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Pages
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'homepage.html')));
app.get('/home', (req, res) => {
  if (req.session && req.session.user) return res.sendFile(path.join(PUBLIC_DIR, 'homepage1.html'));
  res.redirect('/login.html');
});
app.use(express.static(PUBLIC_DIR));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`❌ ${req.method} ${req.originalUrl}:`, err.message);
  if (!config.isProduction && !config.isTest) console.error(err.stack);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

module.exports = app;
