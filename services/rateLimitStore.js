// express-rate-limit Store backed by MySQL (`rate_limit_hits`), so counters are
// shared by every cluster worker and every serverless instance.
const db = require('../config/db');

class MySqlRateLimitStore {
  constructor({ prefix = 'rl:' } = {}) {
    this.prefix = prefix;
    this.localKeys = false;
    this.windowMs = 60_000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  key(k) {
    return `${this.prefix}${k}`.slice(0, 191);
  }

  async get(key) {
    const [[row]] = await db.execute(
      'SELECT hits, reset_at FROM rate_limit_hits WHERE rl_key = ? AND reset_at > NOW(3)', [this.key(key)]
    );
    return row ? { totalHits: row.hits, resetTime: row.reset_at } : undefined;
  }

  async increment(key) {
    const k = this.key(key);
    const micros = this.windowMs * 1000;
    // A window that has elapsed restarts at 1 hit with a fresh reset time.
    await db.execute(
      `INSERT INTO rate_limit_hits (rl_key, hits, reset_at)
       VALUES (?, 1, NOW(3) + INTERVAL ? MICROSECOND) AS n
       ON DUPLICATE KEY UPDATE
         hits = IF(rate_limit_hits.reset_at <= NOW(3), 1, rate_limit_hits.hits + 1),
         reset_at = IF(rate_limit_hits.reset_at <= NOW(3), n.reset_at, rate_limit_hits.reset_at)`,
      [k, micros]
    );
    const [[row]] = await db.execute('SELECT hits, reset_at FROM rate_limit_hits WHERE rl_key = ?', [k]);
    return { totalHits: row.hits, resetTime: row.reset_at };
  }

  async decrement(key) {
    await db.execute(
      'UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0) WHERE rl_key = ? AND reset_at > NOW(3)', [this.key(key)]
    );
  }

  async resetKey(key) {
    await db.execute('DELETE FROM rate_limit_hits WHERE rl_key = ?', [this.key(key)]);
  }
}

// Housekeeping: drop windows that ended more than a day ago.
async function purgeExpired() {
  const [res] = await db.execute('DELETE FROM rate_limit_hits WHERE reset_at < NOW(3) - INTERVAL 1 DAY');
  return res.affectedRows;
}

module.exports = { MySqlRateLimitStore, purgeExpired };
