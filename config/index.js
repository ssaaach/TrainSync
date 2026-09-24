// Loads .env and the tunables in app.config.json into one frozen object.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const appConfig = require('./app.config.json');

const env = process.env.NODE_ENV || 'development';

module.exports = Object.freeze({
  ...appConfig,
  env,
  isProduction: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT) || appConfig.server.port,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'trainsync',
  },
  sessionSecret: process.env.SESSION_SECRET,
});
