# TrainSync

Trainer matching, workout plans, diet plans and gym search. Node.js + Express 5,
MySQL, static HTML/CSS/JS in `public/`.

> v2 is under construction in phases. This README covers what exists so far and
> will be completed in Phase 8.

## Setup (Windows)

Prerequisites: Node.js 20+, MySQL 8+ (`mysql` / `mysqldump` on `PATH`, or use
the full path `"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"`).

```powershell
npm install
Copy-Item .env.example .env   # then fill in DB_PASSWORD and SESSION_SECRET
npm run migrate               # safe to run repeatedly
npm run dev                   # http://localhost:5000
```

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
services/            normalize.js (free-text → enum values)
public/js/           common.js (api(), escapeHTML, session) + one file per page
public/css/          trainsync-ext.css (all v2 styling)
tests/               api/ (Jest), e2e/ + visual/ (Playwright)
docs/                UI_OVERRIDES.md
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
