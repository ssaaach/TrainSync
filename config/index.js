// Loads .env (validated by config/env.js) and the tunables in app.config.json
// into one frozen object.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { loadEnv } = require('./env');
const appConfig = require('./app.config.json');

const env = loadEnv();
const isProduction = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';
const isServerless = Boolean(env.VERCEL);

function trustProxy() {
  if (env.TRUST_PROXY === undefined) return appConfig.server.trustProxy;
  if (/^\d+$/.test(env.TRUST_PROXY)) return Number(env.TRUST_PROXY);
  if (env.TRUST_PROXY === 'true' || env.TRUST_PROXY === 'false') return env.TRUST_PROXY === 'true';
  return env.TRUST_PROXY;
}

function sslOptions() {
  if (env.DB_SSL !== 'true') return undefined;
  return env.DB_SSL_CA
    ? { ca: env.DB_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
}

module.exports = Object.freeze({
  ...appConfig,
  env: env.NODE_ENV,
  isProduction,
  isTest,
  isServerless,
  port: env.PORT || appConfig.server.port,
  logLevel: env.LOG_LEVEL || (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
  trustProxy: trustProxy(),
  // CORS exists only for the VS Code Live Server workflow (pages on :5500).
  corsOrigins: env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : (isProduction ? [] : appConfig.server.devCorsOrigins),
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: sslOptions(),
    maxTotalConnections: appConfig.db.maxTotalConnections,
    poolSize: env.DB_POOL_SIZE || (isServerless ? appConfig.db.serverlessPoolSize : appConfig.db.poolSize),
    connectTimeoutMs: appConfig.db.connectTimeoutMs,
    queryTimeoutMs: appConfig.db.queryTimeoutMs,
    retry: appConfig.db.retry,
  },
  sessionSecret: env.SESSION_SECRET,
  demoPassword: env.DEMO_PASSWORD,
  mlServiceUrl: env.ML_SERVICE_URL,
  ollamaUrl: env.OLLAMA_URL,
  cronSecret: env.CRON_SECRET,
  workers: env.WEB_CONCURRENCY || appConfig.server.workers,
  threadpoolSize: env.UV_THREADPOOL_SIZE || appConfig.server.threadpoolSize,
});
