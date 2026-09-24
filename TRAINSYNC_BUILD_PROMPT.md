# TrainSync v2: Build Prompt

> Paste everything below this line into your coding agent (e.g. Claude Code) opened at the root of the `TrainSync` folder.

---

## 0. Role, context and ground rules

You are extending **TrainSync**, an existing fitness web app, into an application-ready product. Read the whole codebase before you write anything. The current state is:

**Stack (keep it):** Node.js + Express 5 (`server.js`, `routes.js`, `database.js`), MySQL via `mysql2/promise` pool, `express-session` + `express-mysql-session`, `bcrypt`. The frontend is **static vanilla HTML/CSS/JS** in `public/`, served by `express.static`. There is no framework or bundler. The dev machine is **Windows** and the project sits in a **OneDrive** folder, so every script must be cross-platform: use npm scripts and Node/Python, not bash-only commands.

**Pages that exist today:** `homepage.html` (public landing), `homepage1.html` (logged-in landing), `login.html`, `registration.html`, `trainermatch.html` (hard-coded 3-trainer carousel), `workoutplans.html`, `dietplans.html`, `gyms.html`. Each page has its own `.css`.

**Schema:** `trainsync_tables.sql`, with tables `users`, `trainees`, `trainers`, `matches`, `gyms`, `diets`, `workouts`. The live DB already contains hand-entered rows in `gyms`, `diets` and `workouts`. **Never drop or truncate these tables.** All schema changes are additive migrations.

### 0.1 The UI freeze (the most important constraint)

The owner wants **the exact same visual design**. Treat the current look as a locked design system:

- **Tokens to reuse and never alter:**
  - text `#f5f5f5` / `#f0f0f0`
  - accent gold `#ffcc00` (hover `#e6b800`, glow `rgba(255,204,0,0.7)`)
  - glass panels `rgba(20,20,20,0.65)` / `rgba(20,20,20,0.6)` with `backdrop-filter: blur(5px)`, `border-radius: 12px`, `box-shadow: 0 4px 20px rgba(0,0,0,0.4)`
  - inputs `rgba(255,255,255,0.1)` with `1px solid #555` and focus colour `#bfb2af`
  - pill buttons `rgba(0,0,0,0.5)`, `border-radius: 30px`
  - navbar `rgba(0,0,0,0.8)` with hide-on-scroll
  - footer `#1c1c1c`
  - hero overlay text `rgb(213,173,166)`, uppercase
  - background videos `backgroundhome.mp4` / `trainertrainee1.mp4` and the `gymimage1.jpg` + dark overlay
  - font stack `'Poppins', sans-serif`
- **Fonts:** Poppins is declared but never loaded, so the site really renders in the fallback sans-serif. **Do not add a Google Fonts link.** It would visibly change the site.
- **Do not edit or delete any existing CSS selector, HTML element, class, id, image or video.** Do not restyle, reorder or resize the existing navbar, hero, overlay text, info text, Get Started button, search boxes (`.SearchGym`, `.Registration`), result cards (`.gym-card`, `.diet-card`, `.workout-card`), `.carousel-container`, `#reject` / `#match` buttons or footer.
- **Additions only.**
  - All new styling goes in **one new stylesheet, `public/css/trainsync-ext.css`**. Link it after each page's existing stylesheet.
  - Build every new class from the tokens above, so new components (dashboard tiles, tabs, sliders, map panel, charts, modals, landing sections) look native: same glass cards, same gold headings, same pill buttons.
  - Prefix new classes with `ts-` to avoid collisions.
- **Where an existing rule blocks new functionality**, override it in `trainsync-ext.css`, scoped by a body class you add (e.g. `body.ts-scroll { overflow-y: auto; }`), and list every override in `docs/UI_OVERRIDES.md`. One example: `overflow: hidden` on `trainermatch.css` / `login.css` bodies once more content exists.
- **Free-text inputs stay text inputs.** For example, the body-type/goal fields on the workout and diet pages keep their current look. Improve them functionally with `<datalist>` suggestions, server-side normalisation (`"lean bulk"` → `lean-bulk`, `"maintainance"` → `maintenance`, case/whitespace) and prefill from the logged-in user's profile. Do not swap them for `<select>`s.
- **Visual regression gate (mandatory):**
  1. Before changing anything, add Playwright as a dev dependency. Write `tests/visual/baseline.spec.js`, which screenshots every existing page at 1440×900 and 390×844 (with videos paused at frame 0 for determinism), and commit the baselines.
  2. After each phase, re-run it. Existing regions must match pixel-for-pixel (use a `pixelmatch` threshold ≤ 0.1%, masking only areas where new content was intentionally appended below the fold).
  3. Report any diff and fix it before moving on.

### 0.2 Working rules

1. **Start by running `git init`** (there is no repo yet). Add a `.gitignore` for `node_modules`, `.env`, `ml/.venv`, `ml/data/raw`, `__pycache__` and Playwright output. Commit the untouched project as `baseline`. Commit at the end of every phase.
2. Back up the database first with `mysqldump trainsync > backups/pre-v2.sql` (document the Windows command).
3. Work in the phases below, **in order**. At the end of each phase, stop and print:
   - what changed
   - how to run it
   - the acceptance checks you ran and their results

   Do not start the next phase until the current one passes.
4. Use parameterised SQL only. Never interpolate user input into SQL or into `innerHTML`. Add a shared `escapeHTML()` helper and use it for every DB-derived string rendered on the client.
5. Everything synthetic must be flagged `is_synthetic = 1` so it can be purged with one command (`npm run purge:synthetic`).
6. Put all tunable numbers in config files, not in code: thresholds, weights, radii, cluster count range and so on.

---

## Phase 1: Stabilise the base (fix existing bugs, no visual change)

Fix these defects found in the current code:

1. **Login stores `user.id`, but the PK is `users.user_id`.** The session id is therefore `undefined`. Fix it and store `{ user_id, email, role, name }`.
2. **Registration fails in strict SQL mode.** `trainers.location` / `trainees.location` are `NOT NULL` with no default, but register inserts only `user_id`. Add a migration that makes location nullable (or default `'Unknown'`) and adds the new geo columns below.
3. **`/update-profile` is broken.**
   - It reads `req.session.userId` / `req.session.role` (they don't exist).
   - It calls callback-style `db.query` on a promise pool.
   - It writes a `goal` column when the schema has `fitness_goal`.

   Rewrite it with async/await and the correct fields.
4. **Logout mismatch.** The frontend sends `POST`, but the backend defines `GET`. The code also clears a cookie called `session_cookie`, while the real cookie is `connect.sid` (or set a custom `name`). Make logout `POST`, clear the correct cookie and keep backward compatibility.
5. **`homepage1.html` script throws** on undefined `username` / `#greeting`. Replace it with a working session-aware script.
6. **`updateprofile.html` is linked but doesn't exist.** Create it by cloning the `registration.html` template exactly (`.Registration` box, same CSS file). It is role-aware: trainers and trainees get different fields.
7. **The `workouts` table has no `description` column**, but the UI prints `workout.description` (shows "undefined"). Add the column via migration and guard in the UI.
8. **`gyms` schema mismatch.** The base schema has `contact_info`, but the query selects `email`, `website` (the `ALTER`s are commented out), and the UI uses `address` as an `href`. Reconcile via migration: keep `address` as text, add `maps_url`, `email`, `website`, `phone`, `lat`, `lng`.
9. **Hard-coded `http://localhost:5000` in every `fetch`.** Express already serves `public/`, so switch to relative URLs (`/api/...`). Keep the CORS config for the Live-Server workflow.
10. **Session hardening.**
    - Move the session secret to `.env` (`SESSION_SECRET`) and add `.env.example`.
    - Set cookie `sameSite: 'lax'` and `secure` in production.
    - Add `helmet` and `express-rate-limit` on `/api/auth/*`.
11. **Validate `role`** server-side against `trainer|trainee`. The input stays a text box, but add a `<datalist>`.
12. **Dead code.**
    - Delete the duplicate `app.post('/auth/session')` registered after `listen()`.
    - Stop defining routes after `module.exports`.
    - Remove the unused `mysql` package.
13. **Restructure the backend** (no behaviour change for the client beyond the URL prefix):
    ```
    server.js
    config/            # db.js, session.js, app.config.json (all tunables)
    db/migrations/     # 001_*.sql … numbered, idempotent
    db/seeds/
    scripts/migrate.js # runs pending migrations, tracks them in a schema_migrations table
    middleware/        # requireAuth, requireRole('trainer'|'trainee'), validate(schema)
    routes/            # auth.js, profile.js, body.js, workouts.js, diets.js, gyms.js, match.js, notifications.js, stats.js
    services/          # bodyComposition.js, workoutGenerator.js, mealPlanner.js, geo.js, matching.js
    public/js/         # common.js (session, nav state, escapeHTML, api() wrapper), one file per page
    ml/                # Python training pipeline (Phase 5)
    ```
    - Mount APIs under `/api/*`.
    - Keep `/auth/*` as aliases so nothing breaks mid-migration.
    - Use `zod` (or `express-validator`) for request validation.

**Acceptance:**
- Register → login → session → update profile → logout all work for both roles.
- The visual regression suite passes with zero diffs.
- `npm run migrate` is idempotent (runs twice with no error).

---

## Phase 2: Data layer, real datasets plus large synthetic data

Create `db/migrations/` for the following (additive only):

- **`users`**: add `is_synthetic TINYINT DEFAULT 0`, `onboarding_complete TINYINT DEFAULT 0`, `last_active_at`.
- **`trainees`**:
  - body and plan fields: `sex`, `height_cm`, `weight_kg`, `waist_cm`, `neck_cm`, `hip_cm`, `wrist_cm` (optional), `activity_level`, `experience_level ENUM('beginner','intermediate','advanced')`, `goal ENUM('cut','bulk','lean-bulk','maintenance')`, `days_per_week`, `session_minutes`, `equipment JSON`, `diet_pref ENUM('veg','non-veg','eggetarian','vegan','jain')`, `allergens JSON`, `budget_per_session_inr`
  - location and search: `lat DECIMAL(9,6)`, `lng DECIMAL(9,6)`, `geo POINT SRID 4326` (spatial index), `city`, `locality`, `search_radius_km DEFAULT 8`, `modality JSON` (in_person_gym / home / online / outdoor)
  - matching: `languages JSON`, `trainer_gender_pref` (nullable, opt-in hard filter), `big5 JSON`, `style_pref JSON`, `schedule JSON`, `cluster_id`, `cluster_version`
- **`trainers`**: mirror the trainee fields where relevant.
  - `years_experience`, `certifications JSON`, `specializations JSON` (same vocabulary as trainee goals)
  - `price_per_session_inr`, `max_clients`, `active_clients`, `rating_avg`, `rating_count`, `bio`
  - `home_gym_id` (FK → gyms), `travel_radius_km`, `coaching_style JSON`, `big5`, `schedule`, `languages`, `modality`, `lat` / `lng` / `geo`, `cluster_id`
- **`body_assessments`**: an append-only history of every body-type computation, with inputs, outputs and method version.
- **`progress_logs`**: `user_id`, `date`, `weight_kg`, `waist_cm`, `notes`.
- **`exercises`**: see 2.1.
- **`foods`** and **`dishes`**: see 2.2.
- **`user_plans`**: saved generated workout or diet plans as JSON with `generator_version`.
- **`workout_logs`**: `user_id`, `plan_id`, `exercise_id`, `date`, `sets`, `reps`, `load_kg`, `rpe`, `done`.
- **`gyms`**: add `osm_id` (unique), `lat`, `lng`, `geo` (spatial index), `opening_hours`, `phone`, `website`, `email`, `amenities JSON`, `price_tier`, `source ENUM('manual','osm','synthetic')`, `is_synthetic`.
- **`match_interactions`**: `actor_user_id`, `target_user_id`, `action ENUM('like','pass')`, `score`, `created_at`, `UNIQUE(actor,target)`.
- **`matches`**: `ALTER` the status enum to `('pending_trainer','pending_trainee','matched','declined','unmatched','expired')`. Add `score`, `score_breakdown JSON`, `matched_at`, `UNIQUE(trainee_id, trainer_id)`. Map old `pending/accepted/rejected` rows to new values.
- **`notifications`**: `user_id`, `type`, `payload JSON`, `read_at`.
- **`blocks`** and **`reports`**.

### 2.1 Real, freely licensed data (import scripts in `scripts/import/`, cache raw downloads in `ml/data/raw/`)

| Domain | Source | License | What to do |
|---|---|---|---|
| Exercises | **free-exercise-db**, `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json` (800+ exercises: name, force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, instructions, category, images) | Unlicense (public domain) | `import:exercises` → `exercises` table. Image URLs are prefixed with `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/`. Add derived columns `movement_pattern` (squat/hinge/push-h/push-v/pull-h/pull-v/lunge/carry/core/cardio) via a mapping table you write, and `is_compound`. |
| Gyms | **OpenStreetMap via Overpass API**: `nwr["leisure"="fitness_centre"](area)` and `nwr["amenity"="gym"](area)` for Bengaluru, Mumbai, Delhi, Chennai, Hyderabad, Pune | ODbL: attribution "© OpenStreetMap contributors" must appear on the gyms page/map | `import:gyms --city=bengaluru`. Use centroids for ways/relations (`out center tags;`) and map `addr:*`, `phone`, `website`, `opening_hours`, `name`. Upsert on `osm_id`, respect a 1 req/s pace, set a descriptive User-Agent and cache responses. Keep existing manual rows (`source='manual'`). |
| Personality | **Open Psychometrics IPIP-FFM dataset** (`https://openpsychometrics.org/_rawdata/`, file `IPIP-FFM-data-8Nov2018.zip`, ~1M respondents, 50 items) | Public raw data release | Used only to sample realistic Big Five score distributions for synthetic users. Score the 50 items per the IPIP key (reverse-keyed items), then min-max to 0–1. |
| Personality questionnaire shown to users | **Mini-IPIP** (20 items, Donnellan et al. 2006, derived from the public-domain IPIP) | Public domain | Store items, keys and reverse-scoring in `config/mini_ipip.json`. |
| Food nutrients | **USDA FoodData Central** (Foundation + SR Legacy CSV downloads) | CC0 | `import:foods`: keep ~400 staple ingredients (grains, dals, dairy, eggs, meats, oils, vegetables, fruits, nuts) with kcal/protein/carbs/fat per 100 g. |
| Pincode → lat/lng (optional) | **All India Pincode Directory** on data.gov.in | Open Government Data License – India | Offline geocoding of pincode to approximate coordinates. |

If a source is unreachable, log it clearly and fall back to synthetic data for that domain, marked `is_synthetic=1`. **Do not silently fabricate data under a "real" label.**

### 2.2 Curated plus synthetic data (`db/seeds/`, `ml/generate_synthetic.py`)

- **Indian dishes:** ~150 common dishes (poha, idli-sambar, dal-chawal, rajma, paneer bhurji, chicken curry, egg bhurji, curd rice, sprouts salad, etc.).
  - Each dish has a per-serving gram breakdown into USDA ingredients, so macros are **computed**, not guessed.
  - Tags: `diet_pref`, `meal_slot` (breakfast/lunch/snack/dinner), `allergens`, `prep_minutes`.
- **Locality centroids:** ~40 real Bengaluru localities plus ~10 per other city, with lat/lng. Take coordinates from the OSM/Nominatim results you already fetched and record the source in `db/seeds/localities.csv`.
- **Synthetic people** (Faker `en_IN` names; all `is_synthetic=1`; emails on a reserved domain like `@synthetic.trainsync.test`):
  - **10,000 trainees** and **1,200 trainers** across the 6 cities. Weight Bengaluru at about 40%.
  - Location: the locality centroid plus Gaussian jitter (σ ≈ 1.2 km), clipped to city bounds.
  - Big Five: sample whole rows from the IPIP-FFM empirical distribution, so correlations between traits are preserved.
  - Body data: sample height/weight/waist/neck/hip from sex-specific distributions plausible for urban Indian adults, aged 18–55. Document the parameters and their sources in `ml/README.md`. Derive body type with the Phase 3 calculator, not at random.
  - **Planted latent structure**, so clustering has signal: define 7–8 archetypes, for example:
    - "structured strength beginner"
    - "competitive athlete"
    - "busy-professional fat-loss, prefers early mornings, online"
    - "yoga/mobility, supportive style"
    - "bodybuilding hypertrophy, high intensity"
    - "post-40 general fitness, low-impact"
    - "endurance/runner"

    Each archetype is a prior over goals, style preferences, modality, schedule, budget and experience. Sample each person from one archetype with 25–35% noise. Trainers get analogous archetypes over specialisations and coaching style.
  - Trainer extras:
    - `home_gym_id`: pick a nearby OSM gym within 3 km
    - price tiers realistic for Indian cities (₹300–₹2,500/session)
    - `max_clients` 8–25
    - ratings drawn from Beta(8,2) scaled to 1–5, with `rating_count` Poisson(λ=30)
- **Demo accounts:** `trainee@demo.trainsync.test` and `trainer@demo.trainsync.test`, with complete profiles in Bengaluru. Set the password from `DEMO_PASSWORD` in `.env`. Print the accounts in the README.
- **npm scripts:** `seed`, `seed:synthetic`, `purge:synthetic`, `import:exercises`, `import:gyms`, `import:foods`.

**Acceptance:**
- Row counts are printed after seeding.
- `purge:synthetic` removes every synthetic row and leaves manual/real rows intact.
- Spatial indexes exist, and `EXPLAIN` on a radius query uses them.

---

## Phase 3: Customer dashboard with automatic body-type detection

Turn **`homepage1.html` into the logged-in customer home**.

- Keep its navbar, hero video, "Sore Today, Stronger Tomorrow" overlay, info text and footer exactly as they are.
- Append a new **`<section id="ts-dashboard">`** between `.info-content` and `<footer>`.
- `/home` and post-login redirects go here.
- If `onboarding_complete = 0`, the dashboard shows only an onboarding card that links to the onboarding flow.
- `homepage1`'s Get Started button keeps its look but scrolls to `#ts-dashboard` instead of linking to registration.
- Unauthenticated users hitting `homepage1.html` are redirected to `login.html`.

### 3.1 Onboarding (`onboarding.html`)

Clone the `registration.html` template (same `.Registration` glass box and CSS) and turn it into a multi-step wizard with a gold progress bar in `trainsync-ext.css`. Steps:

1. **Basics:** sex, age, height, weight, city, locality or "use my location" (browser Geolocation API with explicit consent; otherwise pincode/locality lookup).
2. **Measurements for body composition:** waist and neck (plus hip for females), wrist optional. Show an inline "how to measure" tip.
3. **Goal and constraints:** goal (cut / bulk / lean-bulk / maintenance, the existing enum), experience level, days per week, minutes per session, equipment available, activity level, diet preference, allergens.
4. **Personality:** Mini-IPIP, 20 Likert items, one card at a time.
5. **Coaching preferences** (4 mirrored items, 1–5):
   - structure (flexible ↔ strict plan)
   - tone (supportive ↔ tough-love)
   - check-in frequency
   - data-driven ↔ intuitive
6. **Logistics:** modality, weekly schedule grid (7 days × morning/afternoon/evening), languages, budget, search radius, optional trainer-gender preference.

**Trainers** get a parallel wizard: specialisations, certifications, experience, price, capacity, home gym (searchable from the `gyms` table), travel radius, coaching style (same 4 axes), schedule, languages, Mini-IPIP.

Progress is saved per step (`PATCH /api/profile`), so users can resume.

### 3.2 Body-type detection (`services/bodyComposition.js`, versioned `method: "hc-approx-v1"`)

A true Heath–Carter somatotype needs skinfold calipers and bone breadths, which the app does not collect. Implement a **documented approximation** and label it as an estimate in the UI.

- **BMI** = kg / m².
- **Body-fat % (U.S. Navy method, cm):**
  - male: `495 / (1.0324 − 0.19077·log10(waist − neck) + 0.15456·log10(height)) − 450`
  - female: `495 / (1.29579 − 0.35004·log10(waist + hip − neck) + 0.22100·log10(height)) − 450`
- **FFMI** = `weight·(1 − BF) / h²`, normalised: `FFMI + 6.1·(1.8 − h)`.
- **Ectomorphy (exact Heath–Carter HWR formula):** `HWR = height_cm / weight_kg^(1/3)`.
  - HWR ≥ 40.75 → `0.732·HWR − 28.58`
  - 38.25 < HWR < 40.75 → `0.463·HWR − 17.63`
  - otherwise → `0.1`
- **Endomorphy (approx.):** piecewise-linear map from BF% to a 0.5–7 scale.
  - Sex-specific anchors, e.g. male 8% → 1.5, 15% → 3, 25% → 5, ≥32% → 7.
  - Female anchors are about 7 BF points higher.
- **Mesomorphy (approx.):** piecewise-linear map from normalised FFMI to 1–7.
  - Male 17 → 2, 20 → 4, 23 → 6, ≥25 → 7.
  - Female anchors about 3 lower.
- Put all anchors in `config/app.config.json → bodyComposition`.
- Output the three ratings, the dominant type (`ectomorph | mesomorph | endomorph`, which feeds the existing `workouts` / `diets` enums), a secondary type when the top two are within 0.5 (e.g. "meso-endomorph"), and a confidence value.
- Let the user **override** the result. Store both detected and chosen values.
- Also compute:
  - **BMR** (Mifflin–St Jeor)
  - **TDEE** (activity multipliers)
  - calorie target per goal (cut −15 to −20%, lean-bulk +5 to +10%, bulk +10 to +15%, maintenance 0)
  - macro targets: protein 1.6–2.2 g/kg by goal, fat 0.8–1 g/kg, carbs as the remainder
- Unit tests with hand-computed fixtures cover every formula and branch boundary.

### 3.3 Dashboard content

The dashboard is a grid of `ts-card` glass tiles with gold headings. It is role-aware.

**Trainee tiles:**
1. **Body profile:**
   - somatotype triangle as a small inline SVG with the user's point plotted
   - BMI, BF%, FFMI, BMR/TDEE
   - "estimate" badge and a re-measure button
2. **Your plan:** today's workout from the saved plan, with one-click "mark done", and today's calorie/macro targets.
3. **Improvement plan builder:** the user picks the goal, target (e.g. −4 kg or +3 kg lean mass) and pace. The app shows projected weeks to goal (using ~7,700 kcal per kg of fat, with a clear note that it is an estimate) and generates workout + diet plans in one click.
4. **Progress:** a weight and waist trend line from `progress_logs` plus adherence % from `workout_logs`, drawn with Chart.js (from a CDN; gold line on dark, no grid clutter), and a quick-log form.
5. **Your persona and matches:** cluster persona label (Phase 5), top 3 recommended trainers, pending likes, mutual matches.
6. **Nearby gyms:** the three closest gyms, with distance.

**Trainer tiles:**
- incoming trainee requests, ranked by compatibility
- active clients vs capacity
- profile completeness %
- persona label
- trainees near your home gym (aggregate count only)

**Acceptance:**
- A new demo trainee can complete onboarding and see a computed body type with all metrics.
- Changing measurements updates the body type and appends a `body_assessments` row.
- The existing parts of homepage1 are pixel-identical.

---

## Phase 4: Workout planner, diet planner and gyms made interactive with real data

Keep each page's existing search box and result-card styling. All of the following renders inside the existing result containers, or in new `ts-` components styled from the same tokens.

### 4.1 Workout planner (`workoutplans.html` + `services/workoutGenerator.js`)

- If logged in, prefill body type and goal from the profile. The two text inputs remain, with `<datalist>` suggestions and normalisation.
- Add an "Advanced" disclosure (`ts-` styled) for days/week, minutes, equipment and experience. It defaults from the profile.
- **Generator:**
  - **Split by days:** 2–3 = full body, 4 = upper/lower, 5 = PPL + upper/lower, 6 = PPL×2.
  - **Slot templates by movement pattern:** each session covers squat, hinge, horizontal push/pull, vertical push/pull, lunge, core and optional conditioning.
  - Fill slots from `exercises`, filtered by the user's equipment and level. Prefer compounds first.
  - **Set/rep schemes by goal:** strength 3–6, hypertrophy 8–12, endurance 12–20. Rest periods to match. RPE targets by experience.
  - **Body-type and goal modulation:**
    - endomorph + cut → add a conditioning finisher and a higher daily step target
    - ectomorph + bulk → lower conditioning, compound emphasis, +1 set on big lifts
    - mesomorph → balanced
  - **Weekly volume guardrails:** 10–20 hard sets per muscle group per week for intermediates, fewer for beginners. Fit the session time budget.
  - Deterministic for a given seed, so "regenerate" gives a new variation.
- **Interactivity:**
  - Mon–Sun tabs.
  - Each exercise row expands to show instructions and the image from free-exercise-db.
  - A **Swap** button offers 3 alternatives with the same primary muscle, movement pattern and equipment.
  - Mark sets done, which writes to `workout_logs`.
  - **Save plan** writes to `user_plans`.
  - "Progressive overload" hint next week: +2.5 kg or +1 rep when all sets hit their target RPE.
- Fallback: if the generator can't build a plan, show the curated row from the existing `workouts` table (current behaviour).

### 4.2 Diet planner (`dietplans.html` + `services/mealPlanner.js`)

- Targets come from Phase 3 (TDEE and macros).
- Build a 7-day plan from `dishes`:
  - filter by diet preference and allergens
  - 3 meals + 1–2 snacks
  - greedy selection, then a small local search (swap-improve) to land within ±5% of kcal and ±10% of each macro
  - no dish repeated more than twice per week
- **Interactivity:**
  - day tabs
  - a macro ring per day (Chart.js doughnut, gold/greys)
  - swap a dish (the plan re-balances)
  - portion scaling
  - a weekly grocery list aggregated from dish ingredients
  - save plan
- Keep the existing `diets` rows as a fallback, "classic plan" view.

### 4.3 Gyms (`gyms.html` + `routes/gyms.js` + `services/geo.js`)

- Keep the city text input. Add "Use my location" (Geolocation API) and a radius control (1–15 km).
- **Map:** Leaflet (CDN) with OSM tiles. The map sits in a `ts-card` below the search box, and the existing `.gym-card` list stays as the result list.
  - Sync the two: hover a card to highlight its marker, and click a marker to scroll to its card.
  - Show the ODbL attribution.
- **Query:** bounding-box prefilter on the spatial index, then exact distance with `ST_Distance_Sphere` (or haversine in `geo.js`), sorted by distance.
- **Filters:** open now (parse OSM `opening_hours` with the `opening_hours` npm package), price tier, amenities.
- **Gym card additions:** distance, directions link (`https://www.openstreetmap.org/directions?...` or a Google Maps URL), website/phone when present, and "Trainers who train here (n)", which deep-links to matching filtered by `home_gym_id`.
- Existing manual gyms still show. Imported ones have `source='osm'`.

**Acceptance:**
- A Bengaluru "near me" search at 5 km returns real OSM gyms with distances, and the map and list stay in sync.
- The workout generator never violates the equipment filter or the time budget (add property-based tests over 500 random profiles).
- The meal planner hits its tolerances for ≥95% of 500 random profiles (report the rate).

---

## Phase 5: Light clustering model for trainer–trainee compatibility

Build this in Python for training and pure JavaScript for serving, so there is **no Python at runtime**.

### 5.1 Feature space (`ml/features.py`, mirrored exactly in `services/matching.js`)

Trainers and trainees are embedded in **one shared vector space**. Trainees contribute their preferences; trainers contribute what they offer.

| Block | Dims | Trainee | Trainer |
|---|---|---|---|
| Big Five | 5 | Mini-IPIP scores (0–1) | Mini-IPIP scores |
| Coaching style | 4 | preferred style | own coaching style |
| Goals ↔ specialisations | 8 (multi-hot: fat-loss, muscle-gain, strength, endurance, mobility/yoga, sport-specific, general-fitness, beginner-onboarding) | goals | specialisations |
| Modality | 4 | wanted | offered |
| Schedule | 6 (weekday/weekend × morning/afternoon/evening, fraction of slots) | availability | availability |
| Level | 1 | experience level | level they coach best |
| Budget | 1 | budget (log-scaled) | price (log-scaled) |

**Geography is deliberately NOT a clustering feature.** Clusters capture *who fits whom*. Distance is applied at match time as a hard filter plus a decay term, which keeps clusters city-agnostic and reusable.

**Preprocessing:**
- Standardise numeric features (`StandardScaler`).
- **Block-weight** each block by `w_block / sqrt(dims)`, so the 8-dim multi-hot block doesn't dominate. Block weights live in `ml/config.yaml`.

### 5.2 Model (`ml/train_clusters.py`)

- Fit on the combined trainer + trainee population.
- **Model selection:** evaluate KMeans for k = 4…14 and GaussianMixture (full covariance, k = 4…14).
  - Pick by silhouette (primary), Davies–Bouldin and GMM BIC, under a constraint that no cluster falls below 3% of the population.
  - Log a table of all runs to `ml/reports/model_selection.md`, with elbow and silhouette plots saved as PNG.
- **Export** `ml/artifacts/cluster_model_v{N}.json`, containing:
  - feature order
  - scaler mean/std
  - block weights
  - centroids (plus covariances if GMM wins)
  - a `k × k` centroid-affinity matrix (`exp(−d²/2σ²)`, normalised to 0–1)
  - cluster sizes
  - model version
  - training timestamp
  - metrics
- **Persona naming:** name each cluster automatically from its top-3 standardised centroid features (e.g. "Structured Strength Seekers", "Early-Bird Fat-Loss Pros"), then allow manual renaming in `ml/personas.yaml`.
- **Sanity check:** report adjusted Rand index between the found clusters and the planted synthetic archetypes (expect well above chance, but not 1.0 given the noise), plus a 2-D PCA scatter coloured by cluster.
- Set `npm run train` to call `python ml/train_clusters.py` (document `python -m venv ml/.venv` and `pip install -r ml/requirements.txt`: numpy, pandas, scikit-learn, pyyaml, matplotlib, faker).
- Add an admin-only `POST /api/admin/recluster` that reassigns all users with the current artifact.

### 5.3 Online assignment

- `services/matching.js` loads the latest artifact at boot.
- When a user completes or edits onboarding, it builds their vector (same code path as training; add a parity test in which Python and JS vectors must match to 1e-6 on 100 fixtures), assigns the nearest centroid (or GMM responsibilities for soft membership) and stores `cluster_id` + `cluster_version`.

### 5.4 Compatibility score (explainable, 0–100)

**Hard filters (exclude when violated):**
- distance ≤ min(trainee search radius, trainer travel radius), unless both allow online
- at least one shared language
- trainer-gender preference, if the trainee set one
- trainer has capacity (`active_clients < max_clients`)
- not blocked
- not already passed within the cooldown window

**Score:**

```
score = 100 × Σ wᵢ·cᵢ   (weights in config/app.config.json → matching.weights, Σ wᵢ = 1)

c_cluster   = affinity[cluster_trainee][cluster_trainer]                          (0–1)
c_goals     = weighted Jaccard(trainee goals, trainer specialisations)
c_style     = 1 − mean |trainee style_pref − trainer coaching_style| / 4
c_person    = personality fit: cosine similarity on Conscientiousness/Openness/Extraversion,
              plus a small bonus when trainer Agreeableness is high for trainees with high Neuroticism
              (document this as a heuristic, configurable)
c_schedule  = |overlap slots| / |trainee slots|
c_distance  = exp(−d_km / d0)   with d0 = 3 km (1.0 if both online)
c_budget    = 1 if price ≤ budget, else exp(−(price − budget)/budget)
c_quality   = Bayesian-average rating (prior mean 4.0, prior weight 10), scaled 0–1
```

Starting weights: goals 0.22, style 0.15, personality 0.12, cluster 0.12, schedule 0.14, distance 0.13, budget 0.07, quality 0.05.

**Candidate generation:**
1. Spatial-index radius query.
2. Order by cluster affinity.
3. Score the top ~300.
4. Return the top N.

**Explanations:** each result carries its `score_breakdown` and **the top-3 contributing reasons** in plain English, e.g. "Specialises in fat loss (your goal)", "2.1 km away, trains at Cult Indiranagar", "Both prefer early-morning sessions", "Structured coaching style, like you asked for". Distance shown to the other party is approximate ("~2 km"); **exact coordinates are never exposed.**

### 5.5 Offline evaluation (`ml/evaluate_matching.py`, report to `ml/reports/matching_eval.md`)

1. When generating synthetic data, also compute a **hidden ground-truth compatibility** per pair from the planted archetypes. Include interaction terms and noise that the scoring formula does **not** have, so the evaluation isn't circular.
2. Simulate like/pass decisions from it: logistic on the ground truth, with position bias.
3. Report **precision@5 / @10, NDCG@10 and mutual-match rate** for:
   - (a) random
   - (b) distance-only
   - (c) goals + distance
   - (d) the full score
   - (e) the full score without the cluster term (ablation)
4. **Stretch goal:** `ml/learn_weights.py` fits the score weights by logistic regression on the simulated interaction logs and writes the proposed weights plus a before/after metric comparison. Never auto-apply them.
5. State clearly in the report that metrics on synthetic data validate the pipeline, not real-world matching quality.

---

## Phase 6: Two-way mutual opt-in matching flow

Keep `trainermatch.html`'s `.carousel-container`, `.trainer-profile` (h2 + p lines), and the **Reject** / **Match** buttons exactly as styled. Replace the hard-coded array with API data.

- **Trainee view:**
  - Cards come from `GET /api/match/recommendations`.
  - Each card fills the existing `h2`/`p` elements (name, specialty, experience) and adds `p` lines for compatibility %, distance and the three reasons, all in the same style.
  - Reject = pass, and Match = like. An optional `ts-` "details" link opens the trainer's profile modal.
  - Replace `alert()` with a `ts-toast`.
- **Trainer view (same page, role-aware):**
  1. **Requests:** trainees who liked the trainer, ranked by score.
  2. **Discover:** recommended trainees, anonymised pre-match. Show first name, persona, goal, approximate distance and schedule overlap only.

  Same carousel and buttons.
- **State machine** (enforced server-side in one transaction):
  ```
  trainee likes  → matches.status = pending_trainer   (trainer gets a notification)
  trainer likes  → matches.status = pending_trainee   (trainee gets a notification)
  second party likes the pending row → matched  (both notified; contact details + "book intro session" unlocked)
  either passes on a pending row     → declined (silent to the liker; no "you were rejected" message)
  either unmatches                   → unmatched
  pending > 14 days                  → expired (cron-less: evaluated lazily on read plus a daily sweep script)
  ```
- **Race safety:**
  - Use `INSERT … ON DUPLICATE KEY UPDATE` on `UNIQUE(trainee_id, trainer_id)` inside a transaction with `SELECT … FOR UPDATE`, so simultaneous likes resolve to exactly one `matched` row.
  - Test it with concurrent requests.
- **Guardrails:**
  - like rate limit (50/day, configurable)
  - pass cooldown of 30 days before a profile can resurface
  - on match, increment trainer `active_clients`; decrement on unmatch
  - block and report endpoints
  - pre-match profiles never include email, phone or exact location
- **Endpoints:**
  - `GET /api/match/recommendations?limit=20`
  - `POST /api/match/:targetUserId/like`
  - `POST /api/match/:targetUserId/pass`
  - `GET /api/match/requests`
  - `GET /api/match/mutual`
  - `POST /api/match/:matchId/unmatch`
  - `POST /api/users/:id/block`
  - `POST /api/users/:id/report`
  - `GET /api/notifications`
  - `POST /api/notifications/read`
- **Notifications:** in-app only. The navbar user menu gets a gold dot badge via polling every 30 s (no websockets). Structure the code so email (e.g. nodemailer) can be added later.
- **Post-match:** a "Mutual matches" list on the dashboard and on trainermatch.html shows contact details and a simple "request intro session" (preferred slot from schedule overlap → notification to the trainer).

**Acceptance:**
- An end-to-end Playwright test covers: demo trainee likes demo trainer → trainer sees the request → trainer likes back → both see the mutual match with contact details unlocked.
- A concurrency test proves there are no duplicate or inconsistent rows.
- The carousel is pixel-identical apart from the added text lines.

---

## Phase 7: A more interactive landing page (`homepage.html`)

Keep the navbar, hero video, "Stay Fit, Stay Strong" overlay, the three info lines, the Get Started button and the footer untouched. **Append** new sections between `.info-content` and `<footer>`. Use `ts-` glass cards, gold headings, the same body text colour, and scroll-reveal via `IntersectionObserver` with a subtle fade/translate. Respect `prefers-reduced-motion`.

1. **What TrainSync does:** 4 feature cards (Smart Trainer Matching, Personalised Workout Planner, Indian-Diet Meal Planner, Gyms Near You). Each has a one-line value proposition and a "Try it" link to its page.
2. **How it works:** a 4-step horizontal stepper: Create profile → We estimate your body type → Get plans + ranked trainers → Both sides opt in, then you train.
3. **Inside the matching engine:** an animated inline-SVG explainer.
   - Profile → feature vector blocks (personality, style, goals, schedule, budget) → cluster ("persona") → compatibility score with the 8 components as bars → distance filter on a mini map → mutual opt-in handshake.
   - Add a short, honest paragraph on what each part does and what data is used.
4. **Interactive mini-demo (no login):** a few sliders (goal, style, schedule, budget, distance) that re-rank 5 sample trainer cards live on the client. It uses the same scoring function exported as a small ES module from `public/js/scoring.js`, which is shared with the server via a UMD/ES build of `services/matching.js`'s pure functions.
5. **Live stats counters:** from `GET /api/stats` (trainers, gyms mapped, exercises, cities, matches made). Count up on scroll. Synthetic users are excluded from public counts, or clearly labelled "demo data".
6. **Privacy and safety:** what is shared before and after a mutual match, that location is approximate, and how to block or report.
7. **FAQ accordion:** 6–8 questions. Include "How accurate is the body-type estimate?" and answer it honestly.
8. **Final CTA:** reuse the exact existing Get Started button markup and class.

**Acceptance:** Lighthouse performance ≥ 80 on desktop (lazy-load below-the-fold scripts: Chart.js, Leaflet); accessibility ≥ 90 for the new sections; hero region pixel-identical.

---

## Phase 8: Hardening, tests and docs

- **Tests:**
  - Jest + Supertest API tests for auth, profile, body, workouts, diets, gyms and every match state transition.
  - Unit tests for `bodyComposition`, `workoutGenerator`, `mealPlanner`, `geo` and `matching`.
  - The Python↔JS feature-parity test.
  - Playwright end-to-end tests for onboarding, planners, gyms and the mutual match flow.
  - The visual-regression suite.
  - `npm test` runs all JS tests. `npm run test:ml` runs pytest for `ml/`.
- **Security:**
  - `requireAuth` / `requireRole` on every private route
  - CSRF protection on state-changing routes (the session-cookie app → `csrf-sync` or double-submit token)
  - output escaping everywhere
  - no PII in logs: remove the current `console.log(req.body)`, which logs passwords
- **Docs:**
  - `README.md`: setup on Windows (MySQL, Node, Python venv), `.env` keys, the full command sequence `npm i → npm run migrate → npm run import:* → npm run seed:synthetic → npm run train → npm run dev`, demo accounts and architecture diagram.
  - `docs/API.md`
  - `docs/MATCHING.md`: features, model selection results, score formula, evaluation table and limitations.
  - `docs/DATA_SOURCES.md`: every dataset with its URL, license and attribution text.
  - `docs/UI_OVERRIDES.md`
- **Scripts:** `dev` (nodemon), `start`, `migrate`, `seed`, `seed:synthetic`, `purge:synthetic`, `import:exercises`, `import:gyms`, `import:foods`, `train`, `evaluate`, `test`, `test:e2e`, `test:visual`.

---

## Definition of done

- [ ] Every existing page is visually identical to the Phase-0 baselines (apart from intentionally appended regions), with all diffs documented.
- [ ] All Phase-1 bugs are fixed, and register/login/logout/profile work for both roles.
- [ ] Real data imported: 800+ exercises, OSM gyms for 6 cities, USDA ingredients. Synthetic data: 10k trainees and 1.2k trainers, purgeable.
- [ ] Logged-in dashboard with the approximate somatotype, BMR/TDEE/macros, plan builder and progress tracking.
- [ ] Interactive workout planner, diet planner and gyms map backed by the new data.
- [ ] Clustering model trained, selected and exported, with persona names and reports. JS inference matches Python.
- [ ] Explainable compatibility scoring with geospatial filtering. The evaluation report beats every baseline on the synthetic benchmark.
- [ ] A race-safe two-way mutual opt-in flow with notifications, privacy rules and block/report.
- [ ] Expanded interactive landing page with the matching-engine explainer and live demo.
- [ ] Test suites green. Docs complete. One-command setup works on a fresh Windows machine.
