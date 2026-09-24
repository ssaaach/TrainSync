# TrainSync v3: Full Reboot Prompt

> Paste everything below into your coding agent, opened at the root of the `TrainSync` folder. The reference images are in `docs/design-refs/`.

---

## 0. Role and ground rules

You are rebooting **TrainSync**, a trainer–trainee matching platform with workout plans, diet plans and a gym finder. It is going to production. This prompt **supersedes `TRAINSYNC_BUILD_PROMPT.md`**. Its UI freeze no longer applies to layout, but the visual identity described in §2 still holds.

**How to work:**
1. **Audit first.** Read every file before you change anything. Write `docs/AUDIT.md` covering security holes, dead or duplicate files (`TrainSyncDB.session.sql`, `trainsync_tables.sql` vs migrations, duplicated per-page CSS), outdated patterns, missing validation, error handling, test gaps and dependency versions.
2. **Propose, then stop.** Write `docs/PLAN.md` with the target architecture, any stack changes (see §4) and the phase order. **Wait for my confirmation before any stack change.**
3. **Build in phases.** Each phase ends with passing tests and a short changelog entry.
4. **Protect existing data.** Never drop or truncate existing tables or real (`is_synthetic = 0`) rows. Every schema change is an additive migration in `db/migrations/`.
5. **Stay cross-platform.** Development happens on Windows inside OneDrive, so use npm or Node/Python scripts, never bash-only ones.

---

## 1. Landing page (public, pre-login) — reference: `ref-landing-layout.png`

**Keep my look exactly:** the black smoky `backgroundhome.mp4` video background, its dark overlay and the current palette (gold `#ffcc00` accent, `#f5f5f5` text, dark glass panels). **Do not copy the reference's lime green or its photography.** Borrow **only its layout and rhythm.**

Build a long, scrolling `homepage.html` that explains everything TrainSync does, section by section:

| Reference section | TrainSync version |
|---|---|
| Nav: logo left, links, highlighted CTA right | Logo · Features · How it works · Gyms · **Log in** (ghost button) · **Get started** (gold button) |
| Hero: huge 2-line headline, 1-line sub, dual CTA, social-proof chip | Headline and sub, **Get started / Log in** CTAs, live stat chip (e.g. trainers or gyms indexed, pulled from the API) |
| "Transform your journey": heading left, paragraph right | What TrainSync is, in 2–3 lines |
| One wide feature card plus 3 tall cards with vertical labels and corner icon badges | Wide card: **AI Trainer Match**. Tall cards: **Workout Plans**, **Diet Plans**, **Gym Finder** |
| Image carousel with arrow buttons, plus a rounded "Location" card | How-it-works steps as a carousel, plus a Gym Finder card with a mini OSM map |
| 3-item product row | 3 "what you get" tiles: sample plan preview, compatibility breakdown, progress tracking |
| Full-width CTA band | Sign-up band with dual CTA |
| Minimal footer | Links, privacy/consent policy, data attributions (per `docs/DATA_SOURCES.md`) |

**Readability over the video (required):**
- Text sits on glass panels (`backdrop-filter: blur`, dark translucent fill) or over a gradient scrim. Never put body copy directly on raw video.
- All text meets WCAG AA contrast (4.5:1 for body, 3:1 for large text). Check it against the brightest smoke frame.
- The video stays `position: fixed` behind all sections so the smoke carries through the whole scroll. Use a subtle scroll-reveal on sections.
- Handle `prefers-reduced-motion` and slow connections by swapping to a poster frame. The video is lazy, muted, `playsinline`, and compressed (WebM plus MP4).
- Fully responsive (360px → 1440px+). Self-host Poppins: it is declared in the CSS today but never loaded.

---

## 2. Profile browsing (trainer match) — reference: `ref-profile-cards.png`

Rebuild `trainermatch.html` so users see **many profiles at once**, borrowing the reference's structure:
- **Grid of large rounded cards** (about 24–28px radius), photo-forward, with a heart (shortlist) and "+" (compare) button overlaid on each card. Include a verified badge, name, specialty and a **compatibility % pill**.
- **Removable filter chips** at the top (goal, specialty, budget, distance, mode, language), plus a search and a saved-list icon.
- **A floating bottom pill** that tracks state ("3 shortlisted · Compare").
- **A detail sheet** that slides up: a summary card (trainer, session type, chosen slot, price), a "why you matched" breakdown, and a primary action (**Request session**).

**Symbiosis rule:** keep the reference's shapes, spacing, chips and floating controls, but render them in the §1 identity (smoke background, dark glass, gold accents). Soft warm-neutral tints are allowed only on secondary surfaces. Pull every shared value into one `public/css/tokens.css` (colors, radii, blur, shadows, spacing, type scale), and build every page from those shared components so the landing, dashboard and match pages feel like one product.

---

## 3. Auth flow and the post-login page

- The landing page keeps its **Log in / Get started** buttons, as it does today.
- Post-login (`homepage1.html` becomes the **dashboard**): the **same layout language** as the landing page, with content limited to what this user can use. That means today's workout, today's meals and macros, top matches, session requests, a progress chart, gyms near me, and a consent/privacy center.
- Nav and content change by role (trainee / trainer). A trainer sees their requests, clients and profile completeness.

---

## 4. Backbone: fault tolerant, 150 concurrent users

**Evaluate the stack and justify it in `PLAN.md`.** Default to keeping Node/Express 5 plus MySQL, which is enough for this load. Propose a change only where it earns its place, and stop for my confirmation. Candidates to evaluate:
- **Redis** for sessions, rate limiting and caching (instead of MySQL-backed sessions).
- **A Python FastAPI ML inference service** (the models in §5–6 need it).
- **A Vite build step** for the frontend.
- **Docker Compose** for app, DB, Redis and ML.

**Non-negotiables:**
- **Login under load:**
  - Must handle **150 simultaneous logins** with no errors, at p95 < 800 ms.
  - bcrypt is async on the libuv threadpool, so tune `UV_THREADPOOL_SIZE` and the bcrypt cost.
  - Size the DB pool, and run a Node cluster or PM2 across the available cores.
  - Prove it with a committed **k6 or autocannon** load test in `tests/load/`.
- **Resilience:**
  - Timeouts on every outbound call.
  - Retry with backoff for transient DB errors.
  - A **circuit breaker** on the ML service, with a rule-based fallback so the app never fails because a model is down.
  - Graceful shutdown.
  - `/healthz` and `/readyz` endpoints.
- **Security:**
  - Session regeneration on login; secure, httpOnly, sameSite cookies; CSRF protection.
  - helmet with a strict CSP.
  - Per-IP and per-account login rate limiting with lockout.
  - zod validation on every route, parameterized SQL only, and env validation at boot.
  - `.env` never committed.
- **Ops:**
  - Structured logging (pino) with request IDs and a central error handler.
  - Migrations run on deploy.
  - A GitHub Actions CI running lint, unit, API, ML and e2e tests.
  - A deploy guide in `docs/DEPLOY.md`.

---

## 5. Plan models: understand physical needs, give comprehensive plans

Use a **hybrid, explainable system**, not a black box:
1. **Physiology layer (deterministic).**
   - BMR by Mifflin-St Jeor, TDEE from activity level, and body-composition estimates (extend `services/bodyComposition.js`).
   - Goal-based calorie and macro targets.
   - A PAR-Q+ style safety screen: flagged users get conservative plans and a "consult a professional" notice.
2. **Meal plans as an optimizer.** Use linear or integer programming (OR-Tools or PuLP) over the USDA-backed `foods` / `dishes` tables. It must:
   - hit calorie, macro and fiber targets and respect diet preference (veg / vegan / jain / egg / non-veg), allergens, cuisine and budget;
   - add variety constraints across the week;
   - output a 7-day plan with per-meal portions in grams, macros, a grocery list and swap suggestions.
3. **Workout plans as a constraint-based periodized generator.** Build it over `free-exercise-db`, driven by:
   - goal, experience level, available equipment, days per week, session length and injuries or limitations (exclude contraindicated movement patterns);
   - movement-pattern balance.

   It produces a 4–12 week block with sets, reps, RPE, rest and progressive overload, and adapts weekly from logged sessions (completed volume, RPE, skipped days).
4. **Learned personalization.** A ranking model (LightGBM) re-ranks meal and exercise candidates from user feedback (likes, swaps, adherence). Until feedback exists, it cold-starts on the rules.
5. **Every plan shows its reasoning**: targets, why each choice was made, and what changes next week. Numbers always come from layers 1–4, never from an LLM. An LLM (optional, local and free, e.g. via Ollama) may only phrase explanations.

---

## 6. Consent-based data collection and matching models

**Consent:**
- **Granular, purpose-bound, opt-in** during onboarding. Separate toggles for body metrics, health and injury info, personality (Mini-IPIP, in `config/mini_ipip.json`), hobbies and interests, location, and use of data for matching.
- Store consent in a versioned **`consent_ledger`** table (user, purpose, policy version, granted or withdrawn, timestamp).
- Users can view, change, **export (JSON)** and **delete** their data from the dashboard. Follow India's DPDP Act 2023 principles.
- Models only read data whose purpose is consented. **Every feature must degrade gracefully when a category is declined.**

**Models (in `ml/`, served by the inference service):**
1. **Trainer–trainee compatibility ranker.**
   - Features: goal ↔ specialization fit, Big Five similarity and complementarity, hobby similarity, schedule overlap, distance (from the OSM gym and locality data), budget and training-mode fit.
   - Learn to rank with LightGBM (lambdarank), trained on the existing synthetic population first and on real accepts and rejects later.
   - Return a score **plus a per-factor breakdown** for the "why you matched" UI.
2. **Hobby and interest embeddings.** Use a free sentence-transformer (`all-MiniLM-L6-v2`) to embed free-text hobbies, bios and specialties for semantic similarity. Precompute and cache vectors.
3. **Personality clustering** (building on the Phase 5 plan in `ml/README.md`). Cluster the IPIP-FFM space for cold-start matching and optional trainee-to-trainee workout buddies.
- Version every model, keep an offline evaluation report (NDCG@10 for ranking, silhouette for clusters), and run a bias check so matches don't skew by gender or age.

---

## 7. Data: free sources only

**Reuse what's already imported:** free-exercise-db, USDA FDC SR Legacy, IPIP-FFM, OSM Overpass/Nominatim and the synthetic population.

**Evaluate and add as needed:**
- USDA FoodData Central Foundation Foods and FNDDS
- the **Indian Nutrient Databank (INDB)** or other open Indian food-composition data
- **Open Food Facts** (ODbL)
- **wger** exercise data (CC BY-SA)
- the **Compendium of Physical Activities** (MET values)
- **NHANES** body-measurement data for realistic synthetic body metrics
- `all-MiniLM-L6-v2` (Apache-2.0)

**For every source:**
- Verify it is reachable and check its license before use.
- Download it through a script in `scripts/import/`, cache it in `ml/data/raw/` and document it in `docs/DATA_SOURCES.md`.
- Show the required attribution in the UI.
- Never scrape, and never label synthetic data as real.

---

## 8. Definition of done

- `AUDIT.md`, `PLAN.md`, `DEPLOY.md` and an updated `DATA_SOURCES.md` exist.
- The landing page, dashboard and trainer-match page match §1–3. Playwright visual baselines are regenerated, and e2e tests cover sign-up → consent → plan generation → match → session request.
- The load test passes 150 concurrent logins. Tests show the ML service can be killed while the app keeps serving rule-based results.
- The models are trained, evaluated and versioned, and every plan and match returns an explanation.
- All tests are green in CI, and there are no high-severity `npm audit` or `pip-audit` findings.
