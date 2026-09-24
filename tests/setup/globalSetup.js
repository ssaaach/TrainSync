// Creates and migrates the disposable test database before any test runs, and
// clears shared rate-limit counters left by earlier runs.
// Shared by Jest (globalSetup) and Playwright (globalSetup).
module.exports = async function globalSetup() {
  require('./env');
  const { migrate } = require('../../scripts/migrate');
  await migrate({ database: process.env.DB_NAME, log: () => {} });
  const mysql = require('mysql2/promise');
  const config = require('../../config');
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: process.env.DB_NAME,
  });
  await conn.query('DELETE FROM rate_limit_hits');
  await conn.end();
};
