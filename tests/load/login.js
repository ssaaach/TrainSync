#!/usr/bin/env node
// Login load test: 150 simultaneous logins, p95 < 800 ms, zero errors.
//
//   npm run test:load                 starts cluster.js on the test DB
//   npm run test:load -- --url=http://host:port   (existing server; the
//                                     users must exist in its DB — see below)
//   Options: --users=150 --rounds=10 --workers=N --threadpool=N
//
// Two measurements:
//   1. Burst: every virtual user fires its login at the same instant.
//      Latency is measured per request, so p95 is exact.
//   2. Sustained (autocannon): 150 connections logging in back to back, with
//      no pause, for users x rounds requests. This is a stress run beyond the
//      requirement: with zero think time latency is set by CPU throughput
//      (Little's law: ~150 / logins-per-second), so only its error count is
//      gated; its latency (autocannon reports p97.5, not p95) is reported.
// Gate: burst p95 < 800 ms and zero errors in both runs.
// Each virtual user has its own session, CSRF token and client IP
// (X-Forwarded-For), like real users behind the app's one trusted proxy hop.
const path = require('path');
const { spawn } = require('child_process');
const autocannon = require('autocannon');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const config = require('../../config');

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const USERS = Number(args.users) || 150;
const ROUNDS = Number(args.rounds) || 10;
const P95_BUDGET_MS = 800;
const PORT = 5088;
const BASE = args.url || `http://localhost:${PORT}`;
const DB_NAME = process.env.TEST_DB_NAME || 'trainsync_test';
const DOMAIN = '@load.trainsync.test';
const PASSWORD = 'load-test-password-1';

const emailOf = i => `load-${i}${DOMAIN}`;
const ipOf = i => `10.77.${Math.floor(i / 250)}.${(i % 250) + 1}`;
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function seedUsers(conn) {
  await conn.query('DELETE FROM users WHERE email LIKE ?', [`%${DOMAIN}`]);
  await conn.query('DELETE FROM rate_limit_hits');
  // --cost=N is a diagnostic only (measures everything except bcrypt).
  const hash = await bcrypt.hash(PASSWORD, Number(args.cost) || config.auth.bcryptRounds);
  const rows = Array.from({ length: USERS }, (_, i) => [emailOf(i), `Load ${i}`, 'trainee', hash, 1]);
  await conn.query('INSERT INTO users (email, name, role, password, is_synthetic) VALUES ?', [rows]);
}

async function startServer() {
  const env = {
    ...process.env, PORT: String(PORT), DB_NAME, NODE_ENV: 'development', LOG_LEVEL: 'warn',
    ...(args.workers ? { WEB_CONCURRENCY: args.workers } : {}),
    ...(args.threadpool ? { UV_THREADPOOL_SIZE: args.threadpool } : {}),
  };
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'cluster.js')], { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      if ((await fetch(`${BASE}/readyz`)).ok) return child;
    } catch { /* not up yet */ }
  }
  child.kill();
  throw new Error('server did not become ready');
}

// A fresh anonymous session + CSRF token for virtual user i.
async function newSession(i) {
  const res = await fetch(`${BASE}/api/auth/csrf`, { headers: { 'x-forwarded-for': ipOf(i) } });
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const { csrfToken } = await res.json();
  return { cookie, token: csrfToken };
}

async function burst() {
  const sessions = await Promise.all(Array.from({ length: USERS }, (_, i) => newSession(i)));
  const results = await Promise.all(sessions.map(async (s, i) => {
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: s.cookie, 'x-csrf-token': s.token, 'x-forwarded-for': ipOf(i) },
      body: JSON.stringify({ email: emailOf(i), password: PASSWORD }),
    });
    await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status };
  }));
  const ms = results.map(r => r.ms).sort((a, b) => a - b);
  return {
    requests: results.length,
    errors: results.filter(r => r.status !== 200).length,
    statuses: [...new Set(results.map(r => r.status))],
    p50: pct(ms, 50), p95: pct(ms, 95), max: ms[ms.length - 1],
  };
}

async function sustained() {
  // Per-user session state lives outside autocannon's per-connection context
  // (autocannon clears that context each time the request list loops). A
  // free-list guarantees no two connections use the same user at once.
  const state = await Promise.all(Array.from({ length: USERS }, (_, i) => newSession(i)));
  const free = Array.from({ length: USERS }, (_, i) => i);
  const statusCounts = {};
  let sample = null;
  const result = await autocannon({
    url: BASE,
    connections: USERS,
    amount: USERS * ROUNDS,
    timeout: 10,
    requests: [{
      method: 'POST',
      path: '/api/auth/login',
      setupRequest(req, ctx) {
        ctx.slot = free.shift();
        const s = state[ctx.slot];
        return {
          ...req,
          headers: { 'content-type': 'application/json', cookie: s.cookie, 'x-csrf-token': s.token, 'x-forwarded-for': ipOf(ctx.slot) },
          body: JSON.stringify({ email: emailOf(ctx.slot), password: PASSWORD }),
        };
      },
      // Login rotates the session id and the CSRF token; carry them forward.
      onResponse(status, body, ctx, headers) {
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        if (status !== 200 && !sample) sample = String(body).slice(0, 200);
        const s = state[ctx.slot];
        const key = Object.keys(headers).find(k => k.toLowerCase() === 'set-cookie');
        if (key) s.cookie = [].concat(headers[key]).map(c => c.split(';')[0]).join('; ');
        try { const t = JSON.parse(body).csrfToken; if (t) s.token = t; } catch { /* non-JSON */ }
        free.push(ctx.slot);
      },
    }],
  });
  return {
    requests: result.requests.total,
    errors: result.errors + result.timeouts + result.non2xx,
    p50: result.latency.p50, p90: result.latency.p90, p97_5: result.latency.p97_5, max: result.latency.max,
    rps: result.requests.average,
    statusCounts, sample,
  };
}

async function main() {
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: DB_NAME,
  });
  let server;
  try {
    await seedUsers(conn);
    if (!args.url) server = await startServer();

    // Warm-up (JIT, pools) with a handful of logins.
    await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      const s = await newSession(i);
      await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: s.cookie, 'x-csrf-token': s.token, 'x-forwarded-for': ipOf(i) },
        body: JSON.stringify({ email: emailOf(i), password: PASSWORD }),
      });
    }));

    const b = await burst();
    console.log(`\nBurst: ${b.requests} simultaneous logins  p50 ${b.p50.toFixed(0)} ms  p95 ${b.p95.toFixed(0)} ms  max ${b.max.toFixed(0)} ms  errors ${b.errors} (statuses ${b.statuses})`);
    const s = await sustained();
    console.log(`Sustained: ${s.requests} logins over ${USERS} connections  p50 ${s.p50} ms  p90 ${s.p90} ms  p97.5 ${s.p97_5} ms  max ${s.max} ms  ~${s.rps.toFixed(0)} logins/s  errors ${s.errors}`, s.statusCounts, s.sample || "");

    const pass = b.errors === 0 && b.p95 < P95_BUDGET_MS && s.errors === 0;
    console.log(pass
      ? `\nPASS: ${USERS} simultaneous logins with p95 < ${P95_BUDGET_MS} ms; 0 errors in the sustained run`
      : `\nFAIL (gate: burst p95 < ${P95_BUDGET_MS} ms and 0 errors in both runs)`);
    process.exitCode = pass ? 0 : 1;
  } finally {
    await conn.query('DELETE FROM users WHERE email LIKE ?', [`%${DOMAIN}`]).catch(() => {});
    await conn.query('DELETE FROM rate_limit_hits').catch(() => {});
    await conn.end();
    if (server) {
      server.send('shutdown');
      server.kill('SIGTERM');
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
