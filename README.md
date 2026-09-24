# TrainSync

Trainer matching, workout plans, diet plans and gym search. Node.js + Express 5,
MySQL, static HTML/CSS/JS in `public/`.

> v2 is under construction in phases. This README covers what exists so far and
> will be completed in Phase 8.

## Setup (Windows)

Prerequisites: Node.js 20+, MySQL 8+ (`mysql` / `mysqldump` on `PATH`, or use
the full path `"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"`),
and Python 3.11 for the data pipeline.

```powershell
npm install
Copy-Item .env.example .env        # fill in DB_PASSWORD, SESSION_SECRET, DEMO_PASSWORD
py -3.11 -m venv ml/.venv
ml\.venv\Scripts\python -m pip install -r ml/requirements.txt

npm run migrate                    # safe to run repeatedly
npm run import:all                 # exercises, OSM gyms (6 cities), USDA foods, IPIP-FFM (downloads are cached)
npm run seed                       # localities, dishes, demo accounts
npm run seed:synthetic             # 10,000 trainees + 1,200 trainers (is_synthetic = 1)
npm run dev                        # http://localhost:5000
```

`npm run purge:synthetic` removes every synthetic row (demo accounts too; `npm run seed`
re-creates them). Real and imported rows are never touched.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Trainee | `trainee@demo.trainsync.test` | `DEMO_PASSWORD` from `.env` |
| Trainer | `trainer@demo.trainsync.test` | `DEMO_PASSWORD` from `.env` |

Both have complete profiles in Indiranagar, Bengaluru.

Data sources and licences: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). Synthetic-data design:
[ml/README.md](ml/README.md).

### Back up the database first

PowerShell's `>` rewrites the output as UTF-16, which breaks the dump. Use `--result-file` instead:

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
mysqldump -u root -p --single-transaction --routines --triggers --result-file=backups\pre-v2.sql trainsync
```

In Git Bash or cmd, `mysqldump -u root -p trainsync > backups/pre-v2.sql` works too.
To restore from PowerShell: `cmd /c "mysql -u root -p trainsync < backups\pre-v2.sql"`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` / `npm run dev` | Start the server (dev restarts on change via nodemon) |
| `npm run migrate` | Apply pending migrations in `db/migrations/` (tracked in `schema_migrations`) |
| `npm run import:exercises` / `import:gyms` / `import:foods` / `import:ipip` / `import:localities` | Import one dataset (`import:all` runs the first four) |
| `npm run seed` / `seed:synthetic` / `purge:synthetic` | Reference data + demo accounts / synthetic population / remove synthetic rows |
| `npm run test:ml` | pytest for `ml/` |
| `npm test` | Jest + Supertest API tests against the disposable `trainsync_test` DB |
| `npm run test:e2e` | Playwright end-to-end tests (own server on :5055, `trainsync_test` DB) |
| `npm run test:visual` | Visual-regression gate against `tests/visual/baseline/*.png` |

The browser suites use installed **Microsoft Edge** (`channel: msedge`),
because Playwright's bundled Chromium can't play the H.264 background videos.
Set `PW_CHANNEL=chrome` to use Chrome instead. To deliberately re-baseline:
`$env:UPDATE_BASELINE=1; npx playwright test tests/visual`.

## Layout

```
server.js            listen + DB ping
app.js               Express app (helmet, CORS, sessions, rate limit, routes)
config/              index.js (env + app.config.json), db.js, session.js
db/migrations/       numbered, idempotent migrations
scripts/migrate.js   migration runner
middleware/          requireAuth / requireRole, zod validate()
routes/              auth, profile, workouts, diets, gyms
services/            normalize, bodyComposition (hc-approx-v1), dishNutrition, geo
scripts/import/      dataset importers (cached downloads in ml/data/raw/)
scripts/seed/        reference seeds, demo accounts, synthetic loader, purge
db/seeds/            localities.csv, food_manifest.json, dishes.js
ml/                  Python: IPIP scoring, synthetic generator (clustering in Phase 5)
public/js/           common.js (api(), escapeHTML, session) + one file per page
public/css/          trainsync-ext.css (all v2 styling)
tests/               api/ (Jest), e2e/ + visual/ (Playwright)
docs/                UI_OVERRIDES.md, DATA_SOURCES.md
```

## API (so far)

All endpoints are under `/api`. The old `/auth/*` URLs still work as aliases.

- `POST /api/auth/register` `{ email, name, role: trainer|trainee, password, confirmPassword }`
- `POST /api/auth/login` `{ email, password }`
- `POST /api/auth/logout` (`GET` is also accepted)
- `GET  /api/auth/session` → `{ loggedIn, user_id, email, role, name }`
- `GET  /api/profile`, `PATCH /api/profile` (role-aware fields; login required)
- `GET  /api/workouts/:bodyType/:goal`, `GET /api/diets/:bodyType/:goal`
  (free text is normalised: `"Lean Bulk"` → `lean-bulk`, `"maintainance"` → `maintenance`)
- `GET  /api/gyms/:city` (case-insensitive; Bengaluru/Bangalore etc. are aliases)
