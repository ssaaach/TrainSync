# Changelog

v3 is built in phases (see `docs/PLAN.md`). Each entry lists what changed, how to check it, and the gates that passed.

## v3 Phases D–I: plans, matching, dashboard, gyms, release (2026-09-25)

**Workout plans** (`services/workoutGenerator.js`, `config/training.json`, `config/contraindications.json`)
- **Programming:** periodised 4–12 week blocks (accumulation → intensification → deload every 4th week). Splits run from full body to push/pull/legs ×2 depending on days per week, with movement-pattern slots filled from the 876 free-exercise-db exercises.
- **Tailoring:**
  - rep/rest/RPE schemes by goal and experience
  - body-type modulation: finishers and step targets
  - weekly set caps per muscle group
- **Safety:**
  - contraindication rules for 11 limitations
  - a flagged PAR-Q+ screen caps RPE at 6
  - undisclosed health info caps it at 7
- **Features:** warm-up, cool-down, finisher and an estimated kcal (2024 Compendium METs); "why this exercise" on every lift; safe swaps; set logging; next-week adjustments from the logs.
- **Tests:** property-tested over 500 random profiles for equipment, contraindications, time budget, volume caps and effort caps.

**Diet plans** (`services/mealPlanner.js`)
- Each day is a mixed-integer program (HiGHS WebAssembly, in process): one dish per meal, with a continuous portion of 0.5–2 servings.
- Targets: calories, macros and fibre. Hard rules: diet preference, allergens, no same-day repeats, at most twice a week.
- A greedy fallback kicks in if the solver fails.
- Output: grocery list, meal swaps, and a macro ring per day.
- Measured: **81% of days within ±5% kcal and ±10% of every macro** across 40 random profiles (~3 s per week). The misses are aggressive high-protein cuts.

**Matching** (`services/matching.js`, `routes/match.js`, `ml/train_ranker.py`)
- **Hard filters:** language, gender preference, capacity, distance, blocks.
- **Score:** 10 explainable factors (goals, schedule, style, distance, personality, budget, level, interests, modality, ratings). Consent-gated factors drop out cleanly.
- **Learned weights:** pairwise logistic regression on 60k synthetic pairs against a hidden ground truth.
  - NDCG@10 **0.575**, versus 0.565 for goals + distance, 0.428 for distance only and 0.263 random
  - gender exposure ratio 0.99–1.00
  - a missing artifact falls back to the rule weights
- **UI and flow** (`trainermatch.html`):
  - grid of large rounded cards with a compatibility pill, heart (shortlist) and "+" (compare)
  - removable filter chips, search, saved-only toggle, floating "N shortlisted · Compare" pill
  - slide-up detail sheet: summary, "why you matched" bars, request a session in a shared free slot
  - trainer inbox with accept/decline; contact details unlock on acceptance
  - race-safe acceptance (row lock + capacity check), notifications, block and report
  - sample (synthetic) profiles are labelled

**Dashboard** (`homepage1.html`)
- **Trainee:** today's workout, today's meals and targets, body estimate with a somatochart, progress chart and log, top matches and requests with contacts, nearby gyms with directions, notifications, and a privacy center (consent switches, JSON export, account deletion).
- **Trainer:** requests, capacity, profile completeness, trainees nearby and clients.

**Gyms** (`gyms.html`): city search or "use my location", a 1–15 km radius, a Leaflet + OSM map synced with the list, and Google Maps directions/links, website and phone.

**Hardening**
- **CSP:** `style-src 'self'`, so no inline styles anywhere.
- **Cleanup:** legacy CSS, scripts and pages removed. `updateprofile.html` redirects to the profile editor.
- **Docs:** `docs/DEPLOY.md` (Vercel + managed MySQL, or PM2 + Nginx), a rewritten README, and `DATA_SOURCES.md` updated with evaluated and rejected sources.

## v3 Phase C: consent, onboarding and data rights (2026-09-24)

**Consent** (`services/consent.js`, migrations 005–006)
- `consent_ledger` is append-only: user, purpose, granted, policy version, source, timestamp. Six purposes: `body_metrics`, `health`, `personality`, `interests`, `location`, `matching`. The current state is the latest row per purpose, and no row means not granted. The ledger has no foreign key, so a minimal withdrawal record survives account deletion.
- **Withdrawing a purpose erases its data in the same transaction** (DPDP s.8(7)):
  - body metrics: the measurements, the body type, and all `body_assessments` and `progress_logs` rows
  - health: limitations and `health_screens`
  - personality: Big Five scores and cluster
  - interests: hobbies and interests
  - location: coordinates and locality (the city stays)
- `requireConsent(purpose)` guards routes, and onboarding steps whose purpose is declined are refused (`consent_required`) and skipped in the UI.
- Synthetic and demo users are recorded as consenting to everything (they were generated with every category filled). Real users who finished the old flow are sent through the new consent-first onboarding. The seeders and `purge:synthetic` maintain these rows.

**Onboarding** (`/api/onboarding`, `public/onboarding.html`)
- **Account creation:** registering signs you in and goes straight to onboarding. Login and the dashboard send unfinished users back to it.
- **Trainee steps:**
  - consent
  - about you (**18+ only**: DPDP requires verifiable parental consent for minors)
  - body measurements with a **live estimate** (BF%, BMI, FFMI, body type, TDEE, confidence)
  - goals and training
  - **PAR-Q+ health screen** (any "yes" flags the profile conservative) with injuries/limitations
  - Mini-IPIP one statement at a time (`services/personality.js`)
  - interests, coaching style (4 axes), schedule grid and budget
- **Trainer steps:** consent, about you, coaching profile (specialisations, certifications, price, capacity, bio, **home gym picker** from OSM gyms), coaching style, personality, interests, schedule and area.
- **Behaviour:** every step saves on Continue and the wizard resumes where the user left off. Locality and coordinates are stored only with location consent (a picked neighbourhood uses its public OSM centroid; "use my location" is rounded to about 10 m).
- New public endpoint `/api/localities`.

**Data rights** (`/api/me`)
- `GET` / `PUT /consent`: view and change consent (a change writes a ledger row and erases on withdrawal).
- `GET /export`: everything held about the user as a JSON download (never the password hash).
- `DELETE /`: password plus typed "DELETE". It hard-deletes the account, and everything else cascades; only minimal withdrawal rows stay in the ledger.

**Privacy policy:** now states the 18+ rule.

**Gates**
- Jest 123/123 (18 new consent and onboarding tests: gating, erasure per purpose, no-op consent writes, export, deletion, trainer path).
- e2e 32/32, including the full trainee journey through the UI with axe checks on each step, the trainer journey with declined purposes skipped and resume, forced redirects for unfinished users, export and deletion.
- Visual 30/30, contrast 8/8, lint clean.

## v3 Phase B: design system and landing page (2026-09-24)

**Design system**
- **Shared styles:** `public/css/tokens.css` holds every shared value (colour, radii, blur, shadows, 4 px spacing scale, fluid type scale, motion, z-layers). `public/css/components.css` builds the components on top: nav, gold/ghost/dark buttons, icon buttons, glass cards, removable chips, tags, compatibility pill, floating bottom pill, slide-up sheet, tabs, toasts, form fields, segmented control, switch, meters and footer.
- **Shared chrome:** `public/js/layout.js` renders the role-aware nav (visitor, trainee or trainer), the footer with data attributions, the fixed smoke background, scroll reveal and toasts. `public/icons.svg` is one icon sprite.
- **Self-hosted, no CDNs:** Poppins (OFL) woff2 files, plus Leaflet and Chart.js vendored into `public/vendor/` by `npm run assets`. Poppins now renders for the first time (it was declared but never loaded).
- **Video:** `npm run assets -- --media` (ffmpeg-static) re-encodes the smoke video.
  - 13.5 MB becomes 133 KB WebM / 405 KB MP4 (a wide crop for desktop, a tall one for phones), with posters and brightest-frame metadata.
  - The coach clip goes from 6 MB to 1 MB, audio removed.
  - The video loads only without reduced motion, Save-Data or a 2G/3G connection; otherwise visitors see the poster (frame 0).

**Pages**
- **`homepage.html` (landing):** rebuilt section by section on the reference layout, in the TrainSync identity:
  - hero with dual CTA and a live stat chip
  - "Transform how you train" split
  - features grid: a wide AI Trainer Match card with the lazy coach video, plus 3 tall cards with vertical labels and corner badges
  - how-it-works carousel with a Gym Finder card holding a mini OSM map (Leaflet loads lazily)
  - 3 "what you get" sample tiles, a CTA band and the footer
- **`login.html` and `registration.html`:** rebuilt on the components, with a trainee/trainer segmented control, show-password and field-level errors. `?next=` accepts same-site paths only.
- **`privacy.html`:** the consent and privacy policy (DPDP principles, per-purpose table, who sees what, rights, deletion, safety, cookies).

**API**
- `GET /api/stats`: real counts only (synthetic data excluded), city spellings merged, cached 5 min.
- `GET /api/gyms/near`: radius search on the spatial index.
- **Map links:** every gym carries Google Maps search and directions links plus an OSM link (`services/geo.mapLinks`).
- City aliasing is shared (`services/normalize.citySpellings`).

**Fixed along the way (found by the new contrast probe):**
- Leaflet markers painted over the fixed nav, and Leaflet's grey container background overrode the dark one.
- The "Sample" tag was 4.2:1.
- On mobile, the CTA band's small print sat over the bright part of the photo.

**Gates**
- `tests/e2e/contrast.spec.js`: every visible text block measured on the rendered page over the **brightest video frame**. All pass (4 pages × 2 widths).
- axe WCAG 2.1 A/AA on landing, login, registration and privacy: 0 violations.
- Landing e2e (stats, carousel, mobile menu, poster vs video, lazy map), plus updated Phase 1 flows: e2e 28/28.
- New visual baselines for the rebuilt pages at 360 / 390 / 768 / 1440 / 1920. Pages not yet rebuilt keep their v2 baselines. Visual 30/30, stable across two runs.
- Jest 105/105, lint clean.

**Still open:** `style-src 'unsafe-inline'` remains until Phase G rebuilds the last legacy pages (their inline `style=` attributes). The source videos stay in `public/` until then too.

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
