// Shared mysql2 promise pool with timeouts and retry for transient errors.
//
//   db.execute / db.query   default per-query timeout; read-only statements
//                           (SELECT/SHOW/WITH/EXPLAIN) are retried on
//                           connection-level errors, writes never are
//   db.withTransaction(fn)  retries the whole transaction on deadlock,
//                           lock-wait timeout or a lost connection
const mysql = require('mysql2/promise');
const config = require('./index');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl,
  waitForConnections: true,
  connectionLimit: config.db.poolSize,
  maxIdle: config.db.poolSize,
  idleTimeout: 60_000,
  queueLimit: 0,
  connectTimeout: config.db.connectTimeoutMs,
  enableKeepAlive: true,
  // DECIMAL lat/lng come back as numbers rather than strings.
  decimalNumbers: true,
});

const CONNECTION_ERRORS = new Set([
  'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
  'ER_CON_COUNT_ERROR', 'PROTOCOL_SEQUENCE_TIMEOUT', 'EHOSTUNREACH',
]);
const TXN_RETRY_ERRNOS = new Set([1213 /* deadlock */, 1205 /* lock wait timeout */]);

const isConnectionError = err => CONNECTION_ERRORS.has(err.code) || err.fatal === true;
const isReadOnly = sql => /^\s*(\(\s*)?(SELECT|SHOW|WITH|EXPLAIN|DESCRIBE)\b/i.test(sql);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Exponential backoff with full jitter.
function backoff(attempt, { baseMs, maxMs }) {
  return Math.random() * Math.min(maxMs, baseMs * 2 ** attempt);
}

async function withRetry(fn, shouldRetry, { retries, ...timing } = config.db.retry) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      await sleep(backoff(attempt, timing));
    }
  }
}

function normalise(sql) {
  return typeof sql === 'string' ? { sql, timeout: config.db.queryTimeoutMs } : { timeout: config.db.queryTimeoutMs, ...sql };
}

function run(method, sql, params) {
  const opts = normalise(sql);
  const retryable = isReadOnly(opts.sql);
  return withRetry(() => pool[method](opts, params), err => retryable && isConnectionError(err));
}

async function withTransaction(fn) {
  return withRetry(async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }, err => TXN_RETRY_ERRNOS.has(err.errno) || isConnectionError(err));
}

async function ping(timeoutMs = 2000) {
  await pool.query({ sql: 'SELECT 1', timeout: timeoutMs });
}

module.exports = {
  pool,
  execute: (sql, params) => run('execute', sql, params),
  query: (sql, params) => run('query', sql, params),
  getConnection: () => pool.getConnection(),
  end: () => pool.end(),
  withTransaction,
  withRetry,
  ping,
  isConnectionError,
};
