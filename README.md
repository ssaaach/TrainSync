# TrainSync

Trainer matching, personalised workout and Indian diet plans, and a gym finder, built with Node.js + Express 5, MySQL 8 and vanilla HTML/CSS/JS.

- **Onboarding** puts consent first: each data category has its own switch, and users can export or delete their data.
- **Workout plans** are periodised 4–12 week blocks built from 876 public-domain exercises. They respect equipment, time, injuries and a PAR-Q+ health screen, and adapt from logged sets.
- **Diet plans** are 7-day Indian meal plans from 182 dishes, optimised with HiGHS to hit calorie, macro and fibre targets. They include swaps and a grocery list.
- **Trainer match** ranks trainers with an explainable score (learned weights, rule fallback). It has shortlist, compare, session requests, and contact details that unlock only after the trainer accepts.
- **Gym finder** shows 700+ OpenStreetMap gyms on a map, with distance and Google Maps directions.

## Run it locally (Windows)

Prerequisites: Node 22, MySQL 8+, and Python 3.11 (only for the data pipeline and model training).

```powershell
npm install
Copy-Item .env.example .env        # fill in DB_PASSWORD, SESSION_SECRET, DEMO_PASSWORD
py -3.11 -m venv ml/.venv
ml\.venv\Scripts\python -m pip install -r ml/requirements.lock

npm run migrate                    # additive, safe to repeat
npm run import:all                 # exercises, OSM gyms, USDA foods, IPIP-FFM (downloads cached)
npm run seed                       # localities, dishes, demo accounts
npm run seed:synthetic             # optional: 10,000 trainees + 1,200 trainers (labelled "Sample profile")
npm run train                      # optional: re-fit matching weights -> ml/artifacts/ranker.json
npm run dev                        # http://localhost:5000
```

Demo accounts: `trainee@demo.trainsync.test` and `trainer@demo.trainsync.test`, both using the `DEMO_PASSWORD` from `.env`.

## Deploy

See [docs/DEPLOY.md](docs/DEPLOY.md). It covers **Vercel** with managed MySQL (e.g. Aiven), or a VM with PM2 + Nginx.

## Tests

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint + ruff |
| `npm test` | Jest unit + API tests against the `trainsync_test` DB |
| `npm run test:e2e` | Playwright journeys (sign-up → consent → plans → match → request → accept), axe accessibility, contrast over the brightest video frame |
| `npm run test:visual` | Visual baselines at 360–1920 px |
| `npm run test:load` | 150 simultaneous logins (p95 < 800 ms gate) |
| `npm run test:ml` | pytest for `ml/` |

## Architecture

```
public/            static pages: tokens.css + components.css design system, layout.js shell
app.js             Express app (helmet CSP, pino, CSRF, MySQL sessions), shared by:
  server.js        long-running server (graceful shutdown), cluster.js (multi-core)
  api/index.js     Vercel function
routes/            auth, onboarding, me (consent/export/delete), plans (workout, diet), match, dashboard, gyms, stats, health
services/          bodyComposition, workoutGenerator, mealPlanner (HiGHS), matching, consent, geo
db/migrations/     numbered, additive; checksummed and locked by scripts/migrate.js
ml/                synthetic population, ranker training (train_ranker.py), reports
```

More docs: [AUDIT](docs/AUDIT.md) · [PLAN](docs/PLAN.md) · [DATA_SOURCES](docs/DATA_SOURCES.md) · [CHANGELOG](CHANGELOG.md) · [ranker evaluation](ml/reports/ranker_eval.md)
