// Long-running HTTP server (local dev, VM/PM2, the cluster workers).
// Vercel does not use this file: it loads api/index.js.
const config = require('./config');

// bcrypt runs on the libuv threadpool, which is sized once, on first use.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || String(config.threadpoolSize);

const logger = require('./config/logger');
const app = require('./app');
const db = require('./config/db');
const { store } = require('./config/session');

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env, threadpool: process.env.UV_THREADPOOL_SIZE }, `Server running on http://localhost:${config.port}`);
});
server.requestTimeout = config.server.requestTimeoutMs;
server.headersTimeout = config.server.headersTimeoutMs;
server.keepAliveTimeout = config.server.keepAliveTimeoutMs;

db.ping(config.db.connectTimeoutMs)
  .then(() => logger.info('Database connected'))
  .catch(err => logger.error({ err: err.message }, 'Database not reachable yet; /readyz will report not_ready'));

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.locals.shuttingDown = true;
  logger.info({ reason }, 'Shutting down: draining connections');

  const force = setTimeout(() => {
    logger.error('Shutdown timed out; forcing exit');
    process.exit(1);
  }, config.server.shutdownTimeoutMs);
  force.unref();

  server.close(async err => {
    try {
      await store.close().catch(() => {});
      await db.end();
    } finally {
      logger.info('Shutdown complete');
      process.exit(err ? 1 : 0);
    }
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// PM2 on Windows (and cluster.js) ask workers to stop with a message.
process.on('message', msg => { if (msg === 'shutdown') shutdown('message'); });

process.on('unhandledRejection', err => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', err => {
  logger.fatal({ err }, 'uncaughtException');
  shutdown('uncaughtException');
});

module.exports = server;
