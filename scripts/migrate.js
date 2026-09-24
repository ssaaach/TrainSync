#!/usr/bin/env node
// Applies pending migrations from db/migrations in filename order and records
// them (with a SHA-256 checksum) in `schema_migrations`.
//
//   .sql  statements run one by one. "Already exists" errors are tolerated so
//         plain ALTER TABLE ... ADD COLUMN stays idempotent on MySQL (which has
//         no ADD COLUMN IF NOT EXISTS); every tolerated statement is reported.
//   .js   module exporting `async up(conn, helpers)` for data transforms.
//
// A named lock (GET_LOCK) makes concurrent deploys wait instead of racing, and
// an applied file whose contents later changed is reported as a warning.
//
// Usage: npm run migrate [-- --database=trainsync_test]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('../config');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const LOCK_TIMEOUT_S = 120;

// ER_TABLE_EXISTS_ERROR, ER_DUP_FIELDNAME, ER_DUP_KEYNAME,
// ER_CANT_DROP_FIELD_OR_KEY, ER_FK_DUP_NAME, ER_DUP_INDEX
const IDEMPOTENT_ERRNOS = new Set([1050, 1060, 1061, 1091, 1826, 1831]);

// Splits SQL on top-level semicolons, ignoring ones inside quotes, backticks
// and comments.
function splitSql(sql) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote !== '`') { cur += next ?? ''; i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '-' && next === '-' && /[\s]/.test(sql[i + 2] ?? ' ')) {
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += '\n';
      continue;
    }
    if (ch === '#') { while (i < sql.length && sql[i] !== '\n') i++; cur += '\n'; continue; }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 1;
      cur += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Line endings are normalised so a Windows (CRLF) and a Linux checkout agree.
const sha256 = buf => crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');

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

async function connect(database) {
  return mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, ssl: config.db.ssl, database, multipleStatements: false,
  });
}

async function migrate({ database = config.db.database, log = console.log } = {}) {
  const admin = await connect(undefined);
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\``);
  await admin.end();

  const conn = await connect(database);
  const lockName = `trainsync_migrate_${database}`.slice(0, 64);
  try {
    const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [lockName, LOCK_TIMEOUT_S]);
    if (got !== 1) throw new Error(`Could not acquire migration lock "${lockName}" within ${LOCK_TIMEOUT_S}s`);

    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    const [cols] = await conn.query("SHOW COLUMNS FROM schema_migrations LIKE 'checksum'");
    const hasChecksum = cols.length > 0;
    const [rows] = await conn.query(`SELECT name${hasChecksum ? ', checksum' : ''} FROM schema_migrations`);
    const applied = new Map(rows.map(r => [r.name, r.checksum || null]));

    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{3}_.+\.(sql|js)$/.test(f)).sort();

    let count = 0;
    for (const file of files) {
      const full = path.join(MIGRATIONS_DIR, file);
      const sum = sha256(fs.readFileSync(full));
      if (applied.has(file)) {
        const recorded = applied.get(file);
        if (recorded && recorded !== sum) log(`  ⚠ ${file} changed after it was applied (checksum mismatch). Add a new migration instead of editing old ones.`);
        continue;
      }
      const skippedStmts = [];
      if (file.endsWith('.sql')) {
        for (const stmt of splitSql(fs.readFileSync(full, 'utf8'))) {
          if ((await runStatement(conn, stmt)) === 'skipped') skippedStmts.push(stmt.split('\n')[0].slice(0, 100));
        }
      } else {
        await require(full).up(conn, { runStatement: s => runStatement(conn, s) });
      }
      const [c2] = await conn.query("SHOW COLUMNS FROM schema_migrations LIKE 'checksum'");
      if (c2.length) await conn.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [file, sum]);
      else await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      log(`  ✔ ${file}${skippedStmts.length ? ` (${skippedStmts.length} statement(s) already applied)` : ''}`);
      for (const s of skippedStmts) log(`      already present: ${s}`);
      count++;
    }

    // Backfill checksums for migrations applied before checksums existed.
    const [c3] = await conn.query("SHOW COLUMNS FROM schema_migrations LIKE 'checksum'");
    if (c3.length) {
      for (const file of files) {
        if (applied.has(file) && !applied.get(file)) {
          await conn.query('UPDATE schema_migrations SET checksum = ? WHERE name = ? AND checksum IS NULL',
            [sha256(fs.readFileSync(path.join(MIGRATIONS_DIR, file))), file]);
        }
      }
    }
    log(count ? `Applied ${count} migration(s) to ${database}.` : `${database} is up to date.`);
    return count;
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    await conn.end();
  }
}

if (require.main === module) {
  const dbArg = process.argv.find(a => a.startsWith('--database='));
  migrate({ database: dbArg ? dbArg.split('=')[1] : undefined })
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
}

module.exports = { migrate, splitSql };
