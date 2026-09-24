#!/usr/bin/env node
// Applies pending migrations from db/migrations in filename order and records
// them in `schema_migrations`.
//
//   .sql  statements run one by one; "already exists" errors are tolerated so
//         plain ALTER TABLE ... ADD COLUMN is idempotent on MySQL (which has no
//         ADD COLUMN IF NOT EXISTS).
//   .js   module exporting `async up(conn, helpers)` for data transforms.
//
// Usage: npm run migrate [-- --database=trainsync_test]
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

// ER_TABLE_EXISTS_ERROR, ER_DUP_FIELDNAME, ER_DUP_KEYNAME,
// ER_CANT_DROP_FIELD_OR_KEY, ER_FK_DUP_NAME, ER_DUP_INDEX
const IDEMPOTENT_ERRNOS = new Set([1050, 1060, 1061, 1091, 1826, 1831]);

function splitSql(sql) {
  return sql
    .split(/\r?\n/)
    .filter(line => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function runStatement(conn, stmt) {
  try {
    await conn.query(stmt);
    return 'applied';
  } catch (err) {
    if (IDEMPOTENT_ERRNOS.has(err.errno)) return 'skipped';
    err.message = `${err.message}\n  in: ${stmt.slice(0, 200)}`;
    throw err;
  }
}

async function migrate({ database = config.db.database, log = console.log } = {}) {
  const admin = await mysql.createConnection({ ...config.db, database: undefined });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\``);
  await admin.end();

  const conn = await mysql.createConnection({ ...config.db, database });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map(r => r.name));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => /^\d{3}_.+\.(sql|js)$/.test(f))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const full = path.join(MIGRATIONS_DIR, file);
      let skipped = 0;
      if (file.endsWith('.sql')) {
        for (const stmt of splitSql(fs.readFileSync(full, 'utf8'))) {
          if ((await runStatement(conn, stmt)) === 'skipped') skipped++;
        }
      } else {
        await require(full).up(conn, { runStatement: s => runStatement(conn, s) });
      }
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      log(`  ✔ ${file}${skipped ? ` (${skipped} statement(s) already applied)` : ''}`);
      count++;
    }
    log(count ? `Applied ${count} migration(s) to ${database}.` : `${database} is up to date.`);
    return count;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  const dbArg = process.argv.find(a => a.startsWith('--database='));
  migrate({ database: dbArg ? dbArg.split('=')[1] : undefined })
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
}

module.exports = { migrate, splitSql };
