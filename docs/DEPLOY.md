# Deploying TrainSync

TrainSync is one Express app. It deploys to **Vercel** (the primary target) or to any VM running Node 22. Either way it needs a **MySQL 8.0.19+** database with spatial support.

## 1. Database (managed MySQL)

Vercel doesn't host MySQL. Use a managed MySQL 8, for example **Aiven for MySQL** (it has a free plan). TiDB won't work: it has no spatial indexes.

1. Create the service, then create a database called `trainsync`.
2. Download the CA certificate.
3. Note the host, port, user and password.
4. Load your data. The easiest way is to restore your local database:
   ```powershell
   & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u root -p --single-transaction --no-tablespaces trainsync > backups\prod-seed.sql
   mysql -h <host> -P <port> -u <user> -p --ssl-ca=ca.pem trainsync < backups\prod-seed.sql
   ```
   Or start empty and run `npm run migrate`, then `npm run import:all`, `npm run seed` and (optionally) `npm run seed:synthetic`, all pointed at the managed DB.
5. Decide about the synthetic demo population before launch. It is labelled "Sample profile" in the UI, and `npm run purge:synthetic` removes it.

## 2. Vercel

1. Push the repo to GitHub and import it in Vercel. `vercel.json` already sets:
   - the build command (`npm run vercel-build`, which runs pending migrations)
   - `public/` as the static output
   - rewrites of `/api/*`, `/healthz`, `/readyz` and `/home` to `api/index.js`
   - a daily cron job
2. Set these **environment variables** (Production):

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | From step 1 |
   | `DB_SSL` | `true` |
   | `DB_SSL_CA` | The CA certificate's PEM text (paste it with `\n` for newlines) |
   | `DB_POOL_SIZE` | `3` |
   | `SESSION_SECRET` | 64 random hex characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `CRON_SECRET` | Another random string. Vercel Cron sends it as a bearer token |
   | `TRUST_PROXY` | `1` |
   | `DEMO_PASSWORD` | Only if you run `npm run seed` against production |

3. Deploy, then check `https://<your-app>/readyz`. It should return `{"status":"ready"}` with `db.ok` and `migrations.ok`.
4. Cookies are `secure` in production, so use the HTTPS URL.

**What runs where on Vercel:**
- **Everything runs in the function:** the workout generator, meal optimiser (HiGHS WebAssembly) and matching ranker (weights in `ml/artifacts/ranker.json`). No Python runs at request time.
- **Meal plans take about 2–5 s to generate.** The function limit is 30 s (`vercel.json`).
- **Rate limits, lockouts and sessions live in MySQL**, so they work across function instances.

## 3. VM alternative (PM2 + Nginx)

```bash
npm ci --omit=dev
npm run migrate
npm i -g pm2
pm2 start ecosystem.config.js --env production   # one worker per physical core
pm2 save && pm2 startup
```

- **Nginx:** proxy `https://your-domain` to `127.0.0.1:5000` with `X-Forwarded-For` / `X-Forwarded-Proto`, and TLS from Let's Encrypt (certbot).
- **Health checks:** point your load balancer or uptime monitor at `/healthz` (liveness) and `/readyz` (readiness).
- **Cron:** schedule `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/daily` once a day.
- **Shutdown:** deploys drain in-flight requests. PM2 sends `shutdown` and `kill_timeout` is 12 s.

## 4. Every deploy

1. `npm run lint && npm test && npm run test:e2e && npm run test:visual`
2. Migrations run automatically (`vercel-build`), or run `npm run migrate` yourself on a VM. They are additive only.
3. After deploying, check `/readyz`.

**Rollback:** redeploy the previous build. Migrations are additive, so older code keeps working.

**Backups:** turn on your provider's daily backups. Before risky changes, take a manual `mysqldump`.

## 5. Retraining the matching model

```powershell
npm run train          # exports pairs from the synthetic population, fits weights, writes ml/artifacts/ranker.json + ml/reports/ranker_eval.md
```

Commit the new `ranker.json` and deploy. If the file is missing or invalid, the app uses the rule weights.
