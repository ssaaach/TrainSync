# TrainSync audit (v3 kickoff)

**Date:** 2026-09-24. **Commit audited:** `a1a2774` (end of v2 Phase 2).

**Scope:** every tracked file except binaries, the lockfile and the visual baselines. I also checked the live `trainsync` database (read-only), `npm audit`, `npm outdated`, and the Jest, Playwright e2e and visual suites.

Severity key:
- **H**: fix before production
- **M**: fix during v3
- **L**: tidy-up

---

## 1. Snapshot

| | |
|---|---|
| Runtime | Node 22.14, Express 5.1, mysql2 3.14, express-session with a MySQL store, bcrypt 5.1, zod 4, helmet 8 |
| DB | MySQL 9.1.0 (dev), strict mode, `max_connections = 151`, 18 tables + `sessions` + `schema_migrations` |
| Data | 11,213 users (11,202 synthetic), 709 gyms (59 manual, 650 OSM), 876 exercises, 402 foods, 182 dishes, 12 `diets` and 12 `workouts` (hand-entered, must be kept), 0 matches |
| Frontend | 9 static pages, vanilla JS (`public/js/*.js`, a shared `common.js`), 8 per-page stylesheets plus `css/trainsync-ext.css` |
| Python | 3.11 venv in `ml/.venv` (numpy, pandas, scikit-learn). Used only for synthetic data generation so far |
| Tests | Jest 78/78 green (unit and API against `trainsync_test`). Playwright e2e is Phase 1 only (8 tests). Visual regression covers the 8 original pages × 2 viewports |
| Hardware (dev) | 16 logical cores, 16 GB RAM, Windows 11, project in OneDrive |

## 2. Secrets and repository hygiene

| # | Sev | Finding |
|---|---|---|
| S1 | ok | `.env` is in `.gitignore` and **has never been committed**. `git log --all -- .env` is empty, and there is no git remote. |
| S2 | ok | No real credentials in history. The only secret-like string is the placeholder `'your-secret-key'` in the baseline `server.js`, and the live `SESSION_SECRET` is a different 64-character value. **No rotation needed.** |
| S3 | L | Test passwords are hard-coded in `tests/` (`correct-horse-9` and others). They are fine because they only reach the disposable `trainsync_test` DB. |
| S4 | M | 44 MB of video is committed in git (`backgroundhome.mp4` 13.5 MB, `trainertrainee.mp4` 24.7 MB, **unused**, `trainertrainee1.mp4` 6.0 MB). Every clone pays for this. |

## 3. Security

| # | Sev | Finding | Where |
|---|---|---|---|
| X1 | H | **No CSRF protection.** `sameSite: 'lax'` blocks most cross-site POSTs, but `express.urlencoded` is enabled and `GET /api/auth/logout` (and `/auth/logout`) change state on a GET. There is no token. | `app.js:39`, `routes/auth.js:89` |
| X2 | H | **Login rate limiting is per-IP and in-memory only.** 50 requests per 15 min covers all `/api/auth/*`. There is no per-account limit and no lockout. The in-memory store also breaks as soon as there is more than one process (cluster/PM2). | `app.js:56` |
| X3 | M | **User enumeration through timing.** An unknown email returns immediately, while a known email pays for a bcrypt compare (~53 ms). | `routes/auth.js:60` |
| X4 | M | **Emails longer than 100 characters cause a 500.** zod has no `max()`, and `users.email` is `VARCHAR(100)`, so strict mode raises `ER_DATA_TOO_LONG`. | `routes/auth.js:13` |
| X5 | M | **Passwords longer than 72 bytes are silently truncated by bcrypt**, yet the schema allows 200 characters. | `routes/auth.js:19` |
| X6 | M | **The CSP isn't strict.** `script-src` allows all of jsdelivr, cdnjs and unpkg (any package on them), and `style-src` has `'unsafe-inline'`, which the inline `style=` attributes on the sidebar and error `<p>`s require. | `config/app.config.json` → `csp` |
| X7 | M | **CORS with credentials for `localhost:5500`** is on in every environment, production included. | `app.js:37` |
| X8 | M | **No env validation at boot.** A missing `DB_PASSWORD` or `DEMO_PASSWORD` only fails later. In dev, a missing `SESSION_SECRET` silently falls back to a random value. | `config/index.js` |
| X9 | M | **Session lifetime is a fixed 24 h**, with no idle timeout, no rolling renewal and no "log out other sessions". | `config/session.js` |
| X10 | L | The legacy `/auth/*` aliases double the attack surface. They can go once the v3 frontend stops using them. | `app.js:73-78` |
| X11 | ok | SQL is parameterised everywhere. The only interpolated identifiers come from fixed maps (`TABLE[role]`, `curatedPlanRouter(table)`). |
| X12 | ok | `escapeHTML`/`safeUrl` are used for every DB string rendered client-side. Login regenerates the session. Passwords are never logged. |

## 4. Reliability and operations

| # | Sev | Finding |
|---|---|---|
| R1 | H | **No `/healthz` or `/readyz`.** The server starts even when the DB is unreachable: it logs and carries on (`server.js:5-12`). |
| R2 | H | **No graceful shutdown.** SIGTERM/SIGINT drops in-flight requests and leaves the pool open. |
| R3 | H | **One process, and the default libuv pool of 4 threads.** Measured: 150 concurrent bcrypt compares take **2.08 s** with the default pool vs **0.61 s** with `UV_THREADPOOL_SIZE=16`. As things stand, 150 simultaneous logins would miss the p95 < 800 ms target. |
| R4 | M | **No DB timeouts or retries.** There is no query timeout, and transient errors (`PROTOCOL_CONNECTION_LOST`, deadlock 1213, lock-wait 1205) go straight to a 500. The pool is fixed at 10 connections. |
| R5 | M | **Logging is `console.log`**, with no structure, request ids or levels. The error handler logs only `err.message`. |
| R6 | M | **The migration runner is fragile:** <br>• it splits files on `;` + newline (a semicolon inside a string or a routine breaks it); <br>• it treats every "already exists" error as success, so a column that exists with a *different* definition passes silently; <br>• it keeps no checksums of applied files and takes no lock, so two deploys can migrate at the same time. |
| R7 | M | **No CI, no linter, no formatter.** |
| R8 | L | `/api/gyms/:city` returns every gym in a city (up to ~650 rows) with no pagination or limit. |

## 5. Dead, duplicate and outdated files

| # | Sev | File | Status |
|---|---|---|---|
| D1 | L | `TrainSyncDB.session.sql` | Empty (0 bytes). A VS Code SQLTools scratch file; delete. |
| D2 | M | `trainsync_tables.sql` | Stale and **contradicts** the migrations (`location NOT NULL`, no v2 columns). `db/migrations/000_base_schema.sql` supersedes it. Delete it, or replace it with a generated `db/schema.sql` dump. |
| D3 | L | `public/homepage1.css` | **Unused.** `homepage1.html` links `homepage.css`. |
| D4 | L | `public/trainertrainee.mp4` (24.7 MB), `public/gymimage.jpg` | Unused. |
| D5 | M | Per-page CSS | 8 stylesheets repeat the same `html, body` / `body::before` / `#bg-video` / `.title` rules. `.SearchGym` is copied into 3 files, `.Registration` into 2, and the navbar/footer into 2. v3 `tokens.css` + components replaces all of this. |
| D6 | L | `docs/UI_OVERRIDES.md`, `css/trainsync-ext.css` | Belong to the v2 pixel freeze, which v3 lifts. Archive both. |
| D7 | L | `TRAINSYNC_BUILD_PROMPT.md` | Superseded by `TRAINSYNC_V3_PROMPT.md`. Keep it for history. |

## 6. Frontend quality and accessibility

| # | Sev | Finding |
|---|---|---|
| F1 | M | 10 `<img>` tags have no `alt` (navbar logo, footer icons). |
| F2 | M | `<button><a href>Get Started</a></button>` nests interactive elements (invalid HTML, and the keyboard focuses it twice). |
| F3 | L | `<button type="Search">` is not a valid type (3 pages). `<label for="username">` points at `#name` (registration). The login email field is `type="text"`. |
| F4 | M | Body copy sits on raw video in places. Error text is `color: red` on dark glass, which fails AA contrast. |
| F5 | M | Poppins is declared but never loaded, so the site renders in the fallback sans-serif. |
| F6 | M | The landing page auto-plays two videos (13.5 MB + 6.0 MB), with no poster, no `prefers-reduced-motion` handling and no Save-Data/slow-network fallback. |
| F7 | L | `workoutplans.js` renders into `#dietResults` (copy-paste naming). |
| F8 | L | The footer's contact links point to a personal Instagram, a university email and LinkedIn. Confirm these are the intended production contacts. |

## 7. Data model debt

| # | Sev | Finding |
|---|---|---|
| M1 | M | **Duplicate legacy columns:** <br>• `trainees`: `gender` vs `sex`; `fitness_goal` (TEXT) vs `goal` (ENUM) vs `goals` (JSON) <br>• `trainers`: `experience` vs `years_experience`; `certification` vs `certifications`; `specialization` vs `specializations` <br>The profile API still writes the legacy ones. |
| M2 | M | **Two id spaces for matching:** `matches` uses `trainee_id`/`trainer_id` (role-table ids), while `match_interactions`, `blocks` and `notifications` use `users.user_id`. Every join has to translate between them. |
| M3 | M | **No consent, health-screen, hobby, shortlist, session-request or feedback tables.** v3 §5–6 needs all of them. |
| M4 | L | `gyms` and the role tables use a `POINT(0 0)` sentinel for missing coordinates, because spatial indexes require NOT NULL. Every query must also filter `lat IS NOT NULL`. This is documented, but easy to forget. |

## 8. Test gaps

- **Auth:** no tests for the rate limit, lockout, CSRF, session expiry or concurrent logins. No load test at all.
- **e2e:** covers Phase 1 flows only. No journeys for onboarding, plans, matching or gyms.
- **Coverage and parity:** no coverage reporting, and no Python↔JS parity tests yet (the feature code doesn't exist yet).
- **Visual:** baselines exist only for the v2 frozen pages. They will be regenerated in v3.
- **Suite status on this audit run:** everything is green: Jest 78/78, Playwright e2e 8/8, visual 16/16.

## 9. Dependencies

`npm audit` reports **11 findings (1 critical, 6 high, 2 moderate, 2 low)**. Every one has a fix:

| Package | Issue | Fix |
|---|---|---|
| `bcrypt` 5.1.1 → `@mapbox/node-pre-gyp` → `tar` | **Critical/high** (install-time path traversal) | `bcrypt@6` (prebuilt binaries, no node-pre-gyp). Hashes are compatible. |
| `mysql2` 3.14.0 (and 3.10.2 nested in `express-mysql-session`) | **High** (auth-plugin downgrade, zlib inflate) | `mysql2@^3.24`. Override the nested copy with an `overrides` entry. |
| `path-to-regexp`, `body-parser`, `minimatch`, `brace-expansion`, `on-headers` | ReDoS/DoS | `npm audit fix` (semver-compatible). |

Outdated but not vulnerable:
- `express` 5.1 → 5.2.1
- `express-session` 1.18 → 1.19
- `dotenv` 16 → 18 (major; optional)
- `pixelmatch` 5 → 7 (dev)

Python requirements use `>=` with no pins or lockfile, and `pip-audit` isn't in the workflow.

## 10. Browser suites (this run)

- **Playwright e2e:** 8/8 passed (13.4 s).
- **Visual regression:** 16/16 passed, with 0 diffs against the v2 Phase 0 baselines (24.5 s).

The v3 redesign replaces these baselines on purpose (see PLAN.md).
