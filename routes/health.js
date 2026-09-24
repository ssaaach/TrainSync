// Liveness and readiness probes.
//   GET /healthz  the process is up (no dependencies checked)
//   GET /readyz   DB reachable and every migration applied; 503 otherwise.
//                 Optional dependencies (ML service) are reported, never fatal.
const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../config/db');

const router = express.Router();
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const CACHE_MS = 30_000;

let migrationCache = { at: 0, pending: null };

async function pendingMigrations() {
  if (Date.now() - migrationCache.at < CACHE_MS && migrationCache.pending) return migrationCache.pending;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{3}_.+\.(sql|js)$/.test(f));
  const [rows] = await db.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map(r => r.name));
  const pending = files.filter(f => !applied.has(f));
  migrationCache = { at: Date.now(), pending };
  return pending;
}

router.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
});

router.get('/readyz', async (req, res) => {
  const checks = {};
  let ready = !req.app.locals.shuttingDown;
  if (!ready) checks.shutdown = 'draining';

  try {
    const t0 = Date.now();
    await db.ping();
    checks.db = { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    ready = false;
    checks.db = { ok: false, error: err.code || err.message };
  }

  if (checks.db.ok) {
    try {
      const pending = await pendingMigrations();
      checks.migrations = { ok: pending.length === 0, pending };
      if (pending.length) ready = false;
    } catch (err) {
      ready = false;
      checks.migrations = { ok: false, error: err.code || err.message };
    }
  }

  const ml = req.app.locals.mlStatus;
  if (ml) checks.ml = ml();

  res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});

module.exports = router;
