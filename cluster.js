// Runs server.js on every core (node:cluster, no extra dependency).
//   npm run start:cluster        workers = config.server.workers (0 = one per physical core)
//   WEB_CONCURRENCY=4 npm run start:cluster
// Dead workers are restarted with a small backoff; SIGINT/SIGTERM drain all
// workers gracefully. PM2 (ecosystem.config.js) is the production alternative.
const cluster = require('node:cluster');
const os = require('node:os');
const config = require('./config');
const logger = require('./config/logger');

// Round-robin connection distribution. Windows defaults to letting the OS pick
// a worker, which piles bursts onto a few processes.
cluster.schedulingPolicy = cluster.SCHED_RR;

if (cluster.isPrimary) {
  // Default: one worker per physical core (logical CPUs / 2 on SMT machines);
  // each worker's libuv pool (threadpoolSize) runs the bcrypt hashes.
  const count = config.workers > 0 ? config.workers : Math.max(1, Math.floor(os.availableParallelism() / 2));
  let stopping = false;
  const restarts = [];

  // Share the DB connection budget between workers (MySQL's default
  // max_connections is 151) unless DB_POOL_SIZE is set explicitly.
  const poolSize = process.env.DB_POOL_SIZE
    || String(Math.max(2, Math.min(config.db.poolSize, Math.floor(config.db.maxTotalConnections / count))));
  const fork = () => cluster.fork({ DB_POOL_SIZE: poolSize });

  logger.info({ workers: count, poolSize, threadpool: config.threadpoolSize }, 'Starting cluster');
  for (let i = 0; i < count; i++) fork();

  cluster.on('exit', (worker, code, signal) => {
    if (stopping) return;
    // More than 10 restarts in a minute means something is badly wrong.
    const now = Date.now();
    restarts.push(now);
    while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
    if (restarts.length > 10) {
      logger.fatal('Workers keep crashing; stopping the cluster');
      process.exit(1);
    }
    logger.warn({ pid: worker.process.pid, code, signal }, 'Worker died; restarting');
    setTimeout(fork, 500 * restarts.length);
  });

  const stop = () => {
    if (stopping) return;
    stopping = true;
    logger.info('Stopping cluster');
    for (const w of Object.values(cluster.workers)) w.send('shutdown');
    setTimeout(() => process.exit(0), config.server.shutdownTimeoutMs + 1000).unref();
    cluster.on('exit', () => { if (!Object.keys(cluster.workers).length) process.exit(0); });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  require('./server');
}
