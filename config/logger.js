// Structured JSON logging (pino). Credentials and cookies are redacted.
const pino = require('pino');
const config = require('./index');

const pretty = !config.isProduction && !config.isTest && process.stdout.isTTY;

const logger = pino({
  level: config.logLevel,
  base: { pid: process.pid },
  redact: {
    paths: [
      'req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]', '*.password', '*.confirmPassword', 'password', 'confirmPassword',
    ],
    censor: '[redacted]',
  },
  ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } } : {}),
});

module.exports = logger;
