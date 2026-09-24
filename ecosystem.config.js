// PM2 process file for a VM deployment (see docs/DEPLOY.md).
//   pm2 start ecosystem.config.js --env production
const os = require('os');
const { db } = require('./config/app.config.json');

// One worker per physical core; see docs/DEPLOY.md (login load test).
const instances = Number(process.env.WEB_CONCURRENCY) || Math.max(1, Math.floor(os.availableParallelism() / 2));
// Keep workers x pool under the DB's connection budget (MySQL default max 151).
const poolSize = Math.max(2, Math.min(db.poolSize, Math.floor(db.maxTotalConnections / instances)));

module.exports = {
  apps: [{
    name: 'trainsync',
    script: 'server.js',
    exec_mode: 'cluster',
    instances,
    kill_timeout: 12000, // > server.shutdownTimeoutMs, so draining can finish
    shutdown_with_message: true, // Windows has no SIGINT for PM2 workers
    max_memory_restart: '512M',
    env: { NODE_ENV: 'development', DB_POOL_SIZE: String(poolSize) },
    env_production: { NODE_ENV: 'production', DB_POOL_SIZE: String(poolSize) },
  }],
};
