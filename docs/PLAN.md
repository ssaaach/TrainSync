# TrainSync v3 plan

**Status: approved 2026-09-24**, with the changes in §0. The findings this plan addresses are in [AUDIT.md](AUDIT.md). The finding IDs (X1, R3, …) refer to that file.

---

## 0. Owner decisions (2026-09-24)

| Q | Answer | Effect |
|---|---|---|
| Q1 stack | Yes | §2 applies, with the Vercel changes below |
| Q2 deploy | **Vercel** (the owner already uses it) | See "Vercel changes" |
| Q3 account deletion | Yes | A user-initiated delete hard-deletes that user's personal data. Only a minimal consent-withdrawal record stays |
| Q4 photos | Yes | Monogram avatars by default. Uploads are resized and **stored in MySQL**, because Vercel's filesystem is read-only and ephemeral |
| Q5 cleanup | Yes | D1–D4 are deleted |
| Maps | "Why not Google Maps links?" | **Every gym gets Google Maps links** for "Open in Maps" and directions (no key needed). The in-page mini map stays on Leaflet + OSM tiles: an embedded Google map with our markers would need a Maps JavaScript API key and a billing account |
| Plans | Comprehensive, tailored workout and diet plans; no placeholders; more appealing; same identity | Phases D and E become generator-first. The 12 hand-entered `diets`/`workouts` rows stay in the DB (never dropped) but are **no longer shown**. The hard-coded "Trainer 1/2/3" carousel goes |

### Vercel changes to the architecture

- **Runtime:**
  - `app.js` stays the single Express app.
  - On Vercel, `api/index.js` exports it as a function, with `vercel.json` rewrites. Static pages are served from `public/` by Vercel's CDN.
  - Locally (and on any VM), `server.js` / `cluster.js` run it as a long-lived server. The 150-login load test runs against that.
- **Models are served in-process in JavaScript and trained offline in Python:**
  - the LightGBM ranker is exported to JSON and evaluated by a JS tree walker (parity test against Python ≤ 1e-6)
  - clusters are exported as JSON centroids
  - the meal optimizer is a **mixed-integer program solved by HiGHS** (the `highs` WASM package, MIT). This is the same class of solver PuLP and SciPy use, so there is no Python at request time.
- **Optional Python FastAPI service:** it only embeds *new* free text (hobbies, bios) with `all-MiniLM-L6-v2`. It runs behind a timeout and circuit breaker, and the fallback is a lexical/tag similarity. Synthetic users' embeddings are precomputed offline and stored in MySQL. If model artifacts fail to load, the rule-based scorer takes over. The kill-test covers both cases.
- **Database:** Vercel doesn't host MySQL, so production needs a managed **MySQL 8** with spatial support (e.g. Aiven's free tier). TiDB is out because it has no spatial indexes. Each function instance uses a small pool, and `DB_POOL_SIZE` is configurable.
- **Cross-instance state:** sessions, rate limits and lockouts are all in MySQL, so they work across function instances. Match expiry is evaluated lazily on read, plus an optional Vercel Cron call to `/api/cron/expire`.

## 1. Target architecture

```
                 Browser (static HTML + native ES modules, tokens.css + components.css)
                        │  HTTPS, session cookie (httpOnly, secure, sameSite=lax) + CSRF header
                        ▼
  ┌──────────────── Node 22 / Express 5 — PM2 cluster, N workers ────────────────┐
  │ pino-http (request id) → helmet (strict CSP) → session (MySQL store) → CSRF   │
  │ → zod validate → routes → services → central error handler                   │
  │                                                                              │
  │ services/                                                                    │
  │   physiology (BMR/TDEE/body comp, PAR-Q+)    ─ deterministic, always local   │
  │   workoutGenerator (periodized, constraints) ─ deterministic, always local   │
  │   mealPlanner.fallback (greedy + local search)                               │
  │   matching.fallback (explainable rule score)                                 │
  │   consent (purpose gate on every personal-data read)                         │
  │   mlClient ── timeout + retry + circuit breaker ──┐                          │
  └───────────────────────┬──────────────────────────┼──────────────────────────┘
                          │ mysql2 pool (timeouts,   │ HTTP/JSON, 127.0.0.1 only
                          │ transient-error retry)   ▼
                          ▼              ┌─ Python 3.11 FastAPI ML service (uvicorn) ─┐
                 MySQL 8.4 LTS / 9.x     │ /rank/trainers   LightGBM lambdarank       │
                 sessions, rate limits,  │ /plan/meals      OR-Tools (CP-SAT/LP)      │
                 consent_ledger, data    │ /rerank/items    LightGBM (plan feedback)  │
                                         │ /embed           all-MiniLM-L6-v2 (cached) │
                                         │ /health          model versions loaded     │
                                         └────────────────────────────────────────────┘
```

**Rule:** if the ML service is down, slow or its circuit is open, every endpoint still answers:
- trainer ranking uses the rule-based scorer
- meal plans use the greedy planner
- re-ranking is skipped

The response carries `"engine": "fallback"`, and the UI shows a small "basic mode" note. No number shown to the user ever comes from an LLM.

## 2. Stack decisions (need your confirmation)

| Candidate | Recommendation | Why |
|---|---|---|
| **Keep Node 22 + Express 5 + MySQL** | **Keep** | This load (150 concurrent users) is small. The data layer, migrations and 78 tests already exist, and nothing in v3 needs a different web stack. |
| **Redis** (sessions, rate limiting, cache) | **Not now** | • **Sessions:** a MySQL session lookup is one primary-key read per request, trivial at this load. <br>• **Rate limiting and lockout:** these *must* be shared across cluster workers (X2), so they go in a small MySQL-backed store (a `rate_limit_hits` table with an `INSERT … ON DUPLICATE KEY UPDATE` counter). <br>• **Caching:** reference data (exercises, dishes, gyms) gets an in-process LRU per worker. <br>• **Cost of Redis:** there is no native Redis on Windows, so dev would need WSL or Memurai, plus a second stateful service to run and monitor. <br>**Revisit** when the app runs on more than one host. |
| **Python FastAPI ML service** | **Adopt** | LightGBM lambdarank, sentence-transformers and OR-Tools are Python-first. Porting them to JS would cost more than a small sidecar. The sidecar binds to `127.0.0.1` and never faces the internet. Node wraps it in timeouts and an `opossum` circuit breaker, with the fallbacks from §1. |
| **Vite build step** | **Not now** | 9 multi-page static screens with vanilla JS. Native `<script type="module">` and one `tokens.css` + `components.css` cover the shared-component goal. Third-party libraries (Leaflet, Chart.js) are **vendored from npm into `public/vendor/`** by a copy script, which lets the CSP become `script-src 'self'` (X6). Caching: ETags plus a short `max-age` for HTML/JS/CSS, and a long `max-age` for fonts, video and vendor files. **Revisit** if we want TypeScript or the JS grows past ~150 KB. |
| **Docker Compose** | **Optional deploy artifact, not a dev dependency** | Docker isn't installed on the dev machine, and dev stays native Windows. I'll write `Dockerfile` (app), `ml/Dockerfile` and `docker-compose.yml` (app + mysql + ml) **only if** the deploy target needs them. See question Q2. |
| **Process model** | **PM2 cluster mode** in production, plus `npm run start:cluster` locally | Uses all cores. PM2 runs on Windows and Linux, restarts crashed workers and handles log rotation. Each worker gets `UV_THREADPOOL_SIZE` from config. |
| **bcrypt** | **Upgrade to v6 and keep cost 10** | Cost 10 is the OWASP minimum for bcrypt, so it doesn't go lower. v6 removes the critical `tar` chain. Existing hashes stay valid. Measured: 150 parallel compares take 0.61 s with a 16-thread pool, so the load target is met by spreading work across cores, not by weakening hashing. |
| **Load-test tool** | **autocannon** (npm) | k6 isn't installed, and autocannon is a devDependency that runs anywhere Node does. The script is committed in `tests/load/`. |
| **Logging** | **pino + pino-http** | Structured JSON, request ids (`X-Request-Id`), and redaction of the `password`, `cookie` and `authorization` fields. |
| **CSRF** | **csrf-sync** (synchronizer token in the session) | `GET /api/auth/csrf` returns the token, and `common.js` `api()` attaches it as `x-csrf-token` to every state-changing request. |
| **Video tooling** | **ffmpeg-static** (dev dependency) | ffmpeg isn't installed. `npm run media:build` makes the WebM (VP9) and MP4 (H.264) versions at 720p plus a poster, targeting ≤ 3 MB each. |

Pool and thread sizing starts at W workers × pool 10 ≤ 100 connections, which leaves headroom under MySQL's `max_connections = 151` for the ML service and migrations. The load test in Phase A settles the actual W and `UV_THREADPOOL_SIZE`.

## 3. Phases

Each phase ends with:
- green tests
- a `CHANGELOG.md` entry
- a commit on the `v3` branch

At the end of each phase I stop and report, the same way as v2.

### Phase A: Backbone and security (**no visual change**)
- **Dependencies:** upgrade bcrypt 6, mysql2 3.24 (plus an `overrides` entry for the nested copy) and the express patch releases; run `npm audit fix`. Target: 0 high/critical.
- **Boot and logging:**
  - env validation with zod at boot (`config/env.js`), fail fast (X8)
  - pino, request ids, central error handler with error codes (R5)
- **Health:** `/healthz` (liveness) and `/readyz` (DB ping + migrations current; reports ML status without failing on it) (R1). Graceful shutdown: stop accepting, drain, close the pool; handles PM2's `shutdown` message (R2).
- **DB resilience:** `connectTimeout`, per-query timeout, and retry with backoff and jitter on transient errors (R4).
- **Auth hardening:**
  - CSRF (X1); logout becomes POST only
  - per-IP + per-account rate limit backed by MySQL, with progressive lockout (`users.failed_logins`, `locked_until`) (X2)
  - constant-time login path with a dummy hash compare (X3)
  - email ≤ 100 characters and password ≤ 72 bytes (X4, X5)
  - rolling idle timeout plus an absolute session cap (X9)
  - CORS only in dev (X7)
- **Migration runner:** statement delimiter handling, a checksum column, and a `GET_LOCK` so only one migrator runs (R6).
- **Tooling:**
  - `cluster` runner, `ecosystem.config.js`
  - **`tests/load/login.js` (autocannon): 150 concurrent logins with 0 errors and p95 < 800 ms**
  - ESLint (flat config) + ruff
  - GitHub Actions: lint, unit/API with a MySQL service, pytest, e2e, `npm audit --audit-level=high`, `pip-audit`
- **Cleanup:** remove D1–D4 (after you answer Q5).
- **Exit:** the old visual suite still has 0 diffs, which proves the backbone changed nothing visible.

### Phase B: Design system and landing page (§1)
- **Design system:**
  - `public/css/tokens.css`: colours, radii (12 / 24–28 px), blur, shadows, spacing scale, type scale
  - `public/css/components.css`: nav, gold and ghost buttons, glass card, chips, pill, sheet, grid, toast, form fields
- **Fonts:** self-hosted Poppins (OFL) woff2 in `public/fonts/` with `font-display: swap`.
- **Video:** compressed WebM + MP4 plus a poster. `position: fixed` behind all sections. Lazy start that skips on `prefers-reduced-motion`, Save-Data, or `effectiveType` 2g/3g (poster only).
- **Landing:** the long-scroll `homepage.html`, section by section per the §1 table, with the live stat chip from `/api/stats` (real counts; synthetic data excluded or labelled). Every text block sits on glass or a scrim.
- **Contrast:** a Playwright test samples the **brightest video frame** behind every text block and asserts WCAG AA (4.5 : 1 for body text, 3 : 1 for large text). Plus axe-core on the page.
- **Other pages:** `privacy.html` and a footer with the attributions from `DATA_SOURCES.md`. Login and registration are rebuilt on the tokens.
- **Exit:** new visual baselines at 360, 390, 768, 1440 and 1920 px; Lighthouse and axe reports saved.

### Phase C: Consent, onboarding, data rights (§6 consent)
- **Consent storage:** a `consent_ledger` table (append-only: user, purpose, policy_version, granted/withdrawn, timestamp) plus a "current consent" view.
- **Purposes:** `body_metrics`, `health`, `personality`, `interests`, `location`, `matching`.
- **Enforcement:** `services/consent.js`, with `requireConsent(purpose)` for routes and `consentedFields(user)` for models. **Declining a purpose removes its features and the model uses the fallback.** Tests cover every purpose.
- **Onboarding** (`onboarding.html`), a stepped wizard:
  - consent first
  - basics, measurements, goals and constraints
  - a PAR-Q+ style health screen (7 questions → `flagged`)
  - injuries/limitations, hobbies and interests (free text + tags)
  - Mini-IPIP (optional, gated by consent), logistics
  - progress saves per step
- **Privacy center** (dashboard): view and change consents, **export all my data (JSON)**, **delete my account** (Q3).

### Phase D: Physiology and workout generator (§5.1, §5.3; JS, deterministic)
- **Physiology:** extend `services/bodyComposition.js`. A PAR-Q+ flag caps intensity (RPE ≤ 6, no max-effort work), removes high-impact conditioning and shows a "consult a professional" notice.
- **Periodization:** a 4–12 week block (accumulation → intensification → deload) built from movement-pattern slots over `exercises`. Filters: equipment, level, days per week and minutes. **Contraindication map:** limitation → excluded patterns and exercises (`config/contraindications.json`, documented).
- **Weekly adaptation from `workout_logs`:**
  - completed volume and RPE drive the load/rep progression
  - skipped days shrink the next week
  - `user_plans` stores every version
- **Explanations:** every plan returns `reasoning`: the targets, why each exercise was chosen, and what changes next week.
- **Tests:** property tests over 500 random profiles (never violates equipment, contraindications or the time budget), plus a fixture test of adaptation.

### Phase E: ML service and meal optimizer (§5.2, §4 resilience)
- **Service:** `ml/service/` FastAPI app (uvicorn) with pinned `requirements.lock`, a `/health` endpoint and model loading from `ml/artifacts/`.
- **Meal optimizer (OR-Tools):**
  - variables: dish × day × slot plus integer portion steps
  - hard constraints: kcal ±5%, macros ±10%, fiber ≥ target, diet preference, allergens, cuisine, budget, and a variety cap (≤ 2 per week per dish, no same-day repeats)
  - objective: preference and variety score
  - output: a 7-day plan with gram portions, macros per meal/day, a grocery list and 3 swap suggestions per meal
- **Node side:**
  - `services/mlClient.js`: timeout, 1 retry, `opossum` breaker
  - `services/mealPlanner.js` fallback: greedy + local search, same output schema
- **Data:** add USDA **Foundation Foods** and **FNDDS** fiber/micronutrients where they improve coverage. Add dish `cost_inr` estimates (a documented assumption) for the budget constraint.
- **Tests:**
  - optimizer hits its tolerances on ≥ 95% of 500 random profiles (rate reported)
  - fallback rate reported the same way
  - **kill-test: stop the ML process mid-suite, and every plan/match endpoint still returns 200 with `engine: "fallback"`**

### Phase F: Matching and personality models (§6 models)
- **Synthetic data:** extend the generator with hobbies/interests (vocabulary per archetype plus templated free text) and a trainer bio/specialty text. Everything stays `is_synthetic = 1`.
- **Embeddings:** `all-MiniLM-L6-v2` for hobbies, bios and specialties. Vectors are precomputed and cached in a `text_embeddings` table, keyed by the text's hash.
- **Clustering:** KMeans/GMM over the IPIP-FFM space (603k real rows), for cold-start matching and optional trainee-to-trainee workout buddies. Reports silhouette.
- **Ranker:** LightGBM lambdarank. Features:
  - goal ↔ specialization fit
  - Big Five similarity and complementarity
  - hobby cosine similarity
  - schedule overlap
  - distance (gym/locality)
  - budget fit and mode fit
  - rating prior

  Labels come from the **hidden ground-truth compatibility** (interaction terms and noise the features don't contain, so the evaluation isn't circular), converted to simulated accepts and rejects. Per-factor breakdown via SHAP contributions (`pred_contrib`) grouped into the factors shown in the UI.
- **Evaluation** (`ml/reports/`): NDCG@10 and precision@k against random, distance-only and rule-based baselines.
- **Bias check:** top-10 exposure ratio and mean score by trainer gender and age band. It flags any group outside the 0.8–1.25 exposure ratio and states that synthetic metrics validate the pipeline, not real-world quality.
- **Model registry:** a `model_registry` table plus versioned artifacts. The service reports its loaded versions, and every match response carries `model_version`.

### Phase G: Trainer match page (§2) and dashboard (§3)
- **`trainermatch.html`:**
  - grid of large rounded cards: photo or monogram (Q4), verified badge, specialty, compatibility pill
  - heart (shortlist) and "+" (compare) buttons
  - removable filter chips, search, saved list
  - floating bottom pill ("3 shortlisted · Compare")
  - slide-up detail sheet: summary, "why you matched" breakdown, **Request session**
- **New tables and APIs:** `shortlists`, `session_requests` (slot from schedule overlap; status machine; notifications), and a trainer inbox.
- **`homepage1.html` dashboard:** role-aware, in the landing page's layout language.
  - **Trainee:** today's workout, today's meals/macros, top matches, session requests, progress chart, nearby gyms, privacy center.
  - **Trainer:** requests, clients vs capacity, profile completeness.
- Workout, diet and gym pages rebuilt on the components.

### Phase H: Learned plan personalization and explanations (§5.4–5.5)
- **Feedback capture:** `plan_feedback` (like, swap, skip, adherence).
- **Re-ranking:** a LightGBM re-ranker for meal and exercise candidates, trained on feedback. It cold-starts on the rules until a user has ≥ N events (configurable).
- **Phrasing:** template-based explanation phrasing by default. Optional **Ollama** phrasing (off unless `OLLAMA_URL` is set) that receives only the computed reasoning JSON and may only rephrase it. A test asserts no numbers were changed.

### Phase I: Release hardening
- **Tests and CI:**
  - full e2e: sign-up → consent → plan generation → match → session request
  - ML kill-test
  - load test
  - CI green, `npm audit` and `pip-audit` with no high findings
- **Docs:** `docs/DEPLOY.md` (target per Q2: PM2 + Nginx + TLS, migrations on deploy, backups, env), plus updates to `docs/DATA_SOURCES.md`, `README.md` and `docs/API.md`.

## 4. Data model changes (all additive migrations)

| Change | Details |
|---|---|
| New tables | `consent_ledger`, `rate_limit_hits`, `health_screens`, `text_embeddings`, `shortlists`, `session_requests`, `plan_feedback`, `model_registry` |
| `users` columns | `failed_logins`, `locked_until`, `deleted_at` |
| `trainees` / `trainers` columns | `limitations` JSON, `hobbies` TEXT, `interests` JSON, `photo_url` |
| Legacy duplicate columns (M1) | Kept and backfilled. New code reads only the canonical columns, and a later migration may drop the legacy ones once you approve. |
| Two id spaces (M2) | New tables key on `users.user_id`. `matches` gets `trainee_user_id` / `trainer_user_id` generated columns so joins stop translating ids. |

## 5. Data sources (§7): evaluation before use

Each source gets a reachability check and a license check in its phase, **before** any import. Results go to `docs/DATA_SOURCES.md`.

| Source | Plan | License note |
|---|---|---|
| USDA FDC Foundation + FNDDS | Use (Phase E) | CC0 |
| Indian Nutrient Databank (INDB) | Evaluate (Phase E) | **License to verify.** If it isn't open, skip it. IFCT 2017 (NIN) is *not* openly licensed and won't be used. |
| Open Food Facts | **Probably skip** | ODbL is share-alike: mixing it into `foods` could put our derived food database under ODbL. We would only need it for packaged products (e.g. whey). |
| wger | **Probably skip** | CC BY-SA 4.0 (share-alike). `free-exercise-db` (public domain) already gives 876 exercises. |
| Compendium of Physical Activities (2024 Adult) | Use for MET-based energy estimates (Phase D) | **Terms to verify.** Citation required. |
| NHANES body measures | Use (Phase F) to take realistic *covariance* between waist, hip, neck and BMI, rescaled to the Indian means already in `ml/README.md` | Public domain (US CDC) |
| all-MiniLM-L6-v2 | Use (Phase F) | Apache-2.0 |
| OSM (already imported) | Keep | **Compliance note:** our `gyms` table is an ODbL *derivative database*. If it is ever offered publicly as data, the OSM-derived part must be offered under ODbL. The UI attribution alone is fine for display. |

## 6. Risks

- **sentence-transformers pulls in PyTorch** (~250 MB CPU wheel). If that's too heavy, fallback: ONNX Runtime with the same model (same license, ~90 MB).
- **Visual baselines are Windows/Edge-specific.** The CI visual job runs on `windows-latest` (Edge preinstalled). The Linux jobs run everything else.
- **All learned models train on synthetic interactions** until real feedback exists. The reports say so plainly.
- **OneDrive sync can lock files** during `npm install` or venv builds. If that happens, pause sync for the folder.

## 7. Open questions (need your answer)

- **Q1:** Approve the stack decisions in §2?
- **Q2:** Deploy target? Options: a single VM with PM2 + Nginx; Docker Compose on a VM; or a PaaS (Render, Railway, Fly). This decides whether Dockerfiles get written and what `DEPLOY.md` covers.
- **Q3:** Account deletion vs "never drop real rows". DPDP gives users the right to erasure, so I propose that **a user-initiated deletion hard-deletes that user's personal data**. Only a minimal consent-withdrawal record stays in `consent_ledger` as evidence. This is the only exception to the rule.
- **Q4:** Trainer photos. I propose generated monogram avatars by default (no AI faces or stock photos passed off as real people), and real users can upload a photo. Uploads are stored on local disk under `uploads/`, resized server-side, and served with `Content-Type` checks.
- **Q5:** OK to delete the unused files: `TrainSyncDB.session.sql`, `trainsync_tables.sql`, `public/homepage1.css`, `public/trainertrainee.mp4` and `public/gymimage.jpg`? They stay in git history.
