# Changelog

v3 is built in phases (see `docs/PLAN.md`). Each entry lists what changed, how to check it, and the gates that passed.

## v3 Phase A: backbone and security (2026-09-24)

No visual change: the old visual suite still passes with 0 diffs.

**Security**
- **CSRF:** `csrf-sync` synchronizer tokens on every state-changing `/api` request. `GET /api/auth/csrf` issues the token, and `public/js/common.js` sends it automatically and retries once if it has gone stale. Login rotates the token. Logout is POST only. (X1)
- **Login throttling:**
  - counts **failed** attempts per IP (100 per 15 min) and per email (5 per 15 min and 20 per day), stored in MySQL so every worker and serverless instance shares it
  - unknown emails lock out the same way as real ones, so a lockout doesn't reveal which accounts exist
  - a successful login costs one SELECT; registration is limited per IP (X2)
- **Constant-time login:** an unknown email still pays for a bcrypt compare against a dummy hash. (X3)
- **Input limits:** email ≤ 100 characters (it used to cause a 500) and password ≤ 72 bytes (bcrypt used to truncate silently). (X4, X5)
- **Headers:**
  - strict CSP (`script-src 'self'`; no CDNs; `object-src 'none'`; `frame-ancestors 'none'`)
  - `x-powered-by` removed
  - CORS only in development or when `CORS_ORIGINS` is set (X6 partly; `style-src 'unsafe-inline'` stays until the Phase B markup rebuild) (X7)
- **Sessions:** 12 h rolling idle timeout plus a 7-day absolute cap from login. (X9)
- **Legacy routes removed:** the `/auth/*` aliases, `GET /api/auth/logout` and `POST /api/auth/session`. (X10)
- **Dependencies:** bcrypt 6, mysql2 3.24 (the nested copy is overridden too), express 5.2 and express-session 1.19. **`npm audit`: 0 vulnerabilities** (was 11, including 1 critical). Python deps are locked in `ml/requirements.lock`; **`pip-audit`: none**.

**Reliability and operations**
- **Env validation at boot** (`config/env.js`, zod): the process refuses to start with a readable list of what's wrong. (X8)
- **Logging:** pino JSON logs with request ids (`X-Request-Id`, which honours a sane upstream id) and redaction of passwords, cookies and tokens. A central error handler returns `{ error, code, requestId }`. (R5)
- **Health:** `GET /healthz` (liveness) and `GET /readyz` (DB ping + pending migrations; 503 while draining). (R1)
- **Graceful shutdown:** on SIGINT/SIGTERM or PM2's `shutdown` message the server stops accepting, drains, closes the session store and the pool, and has a hard timeout. (R2)
- **DB:**
  - connect and per-query timeouts
  - read-only statements retry on connection errors with jittered backoff
  - `withTransaction` retries whole transactions on deadlock or lock-wait (R4)
- **Scaling:**
  - `cluster.js` runs one worker per physical core with round-robin scheduling (Windows' default piles connections onto a few workers)
  - the DB connection budget is split between workers
  - `ecosystem.config.js` does the same for PM2
  - `UV_THREADPOOL_SIZE` comes from config (R3)
- **Vercel:** `api/index.js` exports the same app; `vercel.json` holds the rewrites, a daily cron (`/api/cron/daily`, bearer `CRON_SECRET`), and `vercel-build` runs the migrations.
- **Migration runner** (R6):
  - quote- and comment-aware statement splitting
  - a SHA-256 checksum per file, normalised for CRLF, which warns if an applied file is later edited
  - a `GET_LOCK` so concurrent deploys can't both migrate
  - every tolerated "already exists" statement is reported
- **Tooling:** ESLint (flat config) and ruff; GitHub Actions CI (`.github/workflows/ci.yml`) for lint, audits, Jest on MySQL 8.4, pytest, Playwright e2e on Edge, and visual regression on Windows. (R7)

**Cleanup:** removed `TrainSyncDB.session.sql`, `trainsync_tables.sql`, `public/homepage1.css`, `public/trainertrainee.mp4` (24.7 MB) and `public/gymimage.jpg`. They are unused and still in git history. (D1–D4)

**Gates (all run on the dev laptop: Ryzen 7 5800H, 8 cores / 16 threads, local MySQL 9.1)**
- `npm run lint`: clean (ESLint + ruff)
- `npm test`: 101/101 (23 of them new backbone tests)
- `npm run test:ml`: 13/13
- Playwright: 24/24 (e2e 8, visual 16 with 0 diffs)
- `npm run test:load`, 3 runs:
  - **150 simultaneous logins: p95 732 / 709 / 714 ms, 0 errors**
  - sustained stress run (1,500 logins over 150 back-to-back connections): 0 errors; p97.5 0.94–1.07 s at ~200 logins/s

The sustained run is CPU-bound by bcrypt at cost 10 (the OWASP minimum, deliberately not lowered): 150 × ~53 ms ÷ ~10 effective cores ≈ 0.8 s. On Vercel each login runs on its own function instance, so that ceiling doesn't apply there.

The CI workflow is written but hasn't run yet, because the repo has no GitHub remote.
