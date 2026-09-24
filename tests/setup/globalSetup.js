// Creates and migrates the disposable test database before any test runs.
// Shared by Jest (globalSetup) and Playwright (globalSetup).
module.exports = async function globalSetup() {
  require('./env');
  const { migrate } = require('../../scripts/migrate');
  await migrate({ database: process.env.DB_NAME, log: () => {} });
};
