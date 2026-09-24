#!/usr/bin/env node
// npm run purge:synthetic
// Deletes every row flagged is_synthetic = 1 (users cascade to their trainee/
// trainer rows, assessments, plans, logs, matches, notifications and
// synthetic_profiles). Manual and imported real rows are untouched.
const config = require('../../config');

const DELETE_CHUNK = 2000;

// Deletes synthetic users in chunks (keeps each cascade transaction small).
async function purgeSyntheticUsers(conn, { onlyDomain } = {}) {
  let total = 0;
  for (;;) {
    const [rows] = await conn.query(
      `SELECT user_id FROM users WHERE is_synthetic = 1 ${onlyDomain ? 'AND email LIKE ?' : ''} LIMIT ${DELETE_CHUNK}`,
      onlyDomain ? [`%@${onlyDomain}`] : []
    );
    if (!rows.length) return total;
    const [res] = await conn.query('DELETE FROM users WHERE user_id IN (?)', [rows.map(r => r.user_id)]);
    total += res.affectedRows;
  }
}

async function purgeAll(conn) {
  const removed = { users: await purgeSyntheticUsers(conn) };
  for (const table of ['dishes', 'foods', 'exercises', 'gyms']) {
    const [res] = await conn.query(`DELETE FROM ${table} WHERE is_synthetic = 1`);
    removed[table] = res.affectedRows;
  }
  return removed;
}

if (require.main === module) {
  const db = require('../../config/db');
  const { printCounts } = require('./counts');
  (async () => {
    const conn = await db.getConnection();
    try {
      const removed = await purgeAll(conn);
      console.log('✔ purged synthetic rows:', removed);
      console.log(`  (synthetic users use the reserved domain @${config.seed.syntheticEmailDomain}; demo accounts are re-created by \`npm run seed\`)`);
      await printCounts(conn);
    } catch (err) {
      console.error('purge:synthetic failed:', err.message);
      process.exitCode = 1;
    } finally {
      conn.release();
      await db.end();
    }
  })();
}

module.exports = { purgeSyntheticUsers, purgeAll };
