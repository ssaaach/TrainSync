# TrainSync ML

This folder holds the Python side of TrainSync. It has two jobs:

- **Phase 2:** generating the synthetic population.
- **Phase 5 (to come):** training the clustering model.

At runtime the app never runs Python. Training writes JSON artifacts, and the Node server reads those.

## Setup (Windows)

```powershell
py -3.11 -m venv ml/.venv
ml\.venv\Scripts\python -m pip install -r ml/requirements.txt
```

The npm scripts find this venv on their own, through `scripts/py.js`. You don't need `python` on your PATH. That matters on Windows, where `python` is often just the Microsoft Store alias.

| Command | What it does |
|---|---|
| `npm run import:ipip` | Downloads the IPIP-FFM raw data (about 150 MB) and scores it into `ml/data/raw/ipip/ipip_ffm_scored.npz` |
| `npm run seed:synthetic` | Runs `ml/generate_synthetic.py`, then the Node loader. The loader computes body type with `services/bodyComposition.js` and assigns each trainer a home gym |
| `npm run purge:synthetic` | Removes every `is_synthetic = 1` row |
| `npm run test:ml` | Runs the pytest suite in `ml/tests/` |

## The synthetic population (`generate_synthetic.py`, version `synth-v1`)

It contains **10,000 trainees and 1,200 trainers** spread over 6 cities. Bengaluru has 40%, and the rest are weighted in `config/cities.json`. Everything is deterministic for a given seed. All the numbers below live in `ml/config.yaml`.

Every synthetic row carries three markers:

- `users.is_synthetic = 1`
- an email on the reserved domain `@synthetic.trainsync.test`
- a trainer bio that starts with `[Synthetic demo profile]`

Names come from Faker (`en_IN`). **No real person is represented.**

### Location
Each person gets a random locality in their city. Those locality centroids are real OpenStreetMap coordinates (`db/seeds/localities.csv`, geocoded with Nominatim). On top of the centroid I add Gaussian jitter with σ = 1.2 km, then clip the point to the city's bounding box.

### Big Five: real rows from IPIP-FFM
The source is the Open Psychometrics IPIP-FFM dataset (`IPIP-FFM-data-8Nov2018.zip`, released 2018).

- **Cleaning:** I keep only respondents with `IPC == 1`, as the codebook recommends, who answered all 50 items. That leaves **603,322 rows**.
- **Scoring:** each trait is the sum of 10 items, with reverse-keyed items taken as 6 − x. That sum is scaled to 0–1 as (sum − 10) / 40. The keying follows the item wording in the dataset's `codebook.txt`. The "EST" items are scored as neuroticism, because the Mini-IPIP in the app measures N.
- **Sanity check:** the trait correlations match the literature, for example E–A = +0.31, C–N = −0.24 and E–N = −0.22.
- **Sampling:** each person gets a whole real row. So the correlations between traits are preserved, not simulated. To plant archetype signal, the generator draws 25 candidate rows and picks one with a softmax (β = 1.5) over each row's projection on the archetype's trait "tilt".
- **The app's version:** real users answer the 20-item **Mini-IPIP** (`config/mini_ipip.json`). All 20 of its items are among the 50 IPIP-FFM items, and `ml/tests/test_ipip.py` checks that their keying agrees.

### Body measurements (urban Indian adults, 18–55)

| Parameter | Male | Female | Source / rationale |
|---|---|---|---|
| Height (cm) | N(168.0, 6.8) | N(155.5, 6.2) | NCD Risk Factor Collaboration, *A century of trends in adult human height*, eLife 2016. For India (1996 birth cohort) the means are about 164.9 cm (men) and 152.6 cm (women). I added about +3 cm for an **assumed** urban, higher-income user base |
| BMI | lognormal, median 23.3, log-sd 0.15 | median 23.5, log-sd 0.16 | Chosen so roughly 30–40% have BMI ≥ 25. NFHS-5 (2019–21) reports urban overweight/obesity at about a third of adults. Archetype shifts add +3.0 for the fat-loss professional archetype and −1.5 for runners. Clipped to 16–42 |
| Weight | BMI × height² | same | derived |
| Waist (cm) | 27.0 + 2.40·BMI + N(0, 3.2) | 18.0 + 2.45·BMI + N(0, 3.5) | **Modelling assumption** (see the calibration note below) |
| Neck (cm) | 23.0 + 0.57·BMI + N(0, 1.0) | 19.5 + 0.50·BMI + N(0, 0.9) | **Modelling assumption** |
| Hip (cm) | 55.0 + 1.70·BMI + N(0, 3.0) | 50.0 + 1.90·BMI + N(0, 3.0) | **Modelling assumption** |
| Wrist (cm) | N(16.8, 0.9) × h/168 | N(15.0, 0.8) × h/155.5 | **Modelling assumption** |
| Navy-domain floor | waist − neck ≥ 30 | waist + hip − neck ≥ 110 | Keeps the U.S. Navy formula in a physiological range |

**How the circumference models were calibrated.** I did not fit the waist, neck and hip regressions to a survey. Instead I tuned them so that the U.S. Navy body-fat estimate the app computes from them agrees with an independent equation built from BMI and age: the Deurenberg equation (Deurenberg, Weststrate & Seidell, *Br J Nutr* 1991). For `synth-v1`:

| | Navy BF% median (5th–95th) | Deurenberg median |
|---|---|---|
| Men | 18.6% (8.5–28.4) | 19.2% |
| Women | 32.1% (18.4–46.2) | 31.3% |

The correlation between the two estimates is r = 0.91. The distributions are plausible, but they are **not** drawn from Indian anthropometric microdata.

Body type is **not assigned at random**. The Node loader runs the app's own `hc-approx-v1` calculator on these measurements. It also stores one `body_assessments` row per trainee.

### Planted latent structure (8 archetypes)
The 8 archetypes are: structured strength beginner, competitive athlete, early-bird fat-loss professional, mindful mobility seeker, hypertrophy enthusiast, healthy-ageing low-impact, endurance runner and budget home trainer.

Each archetype sets a prior for trainees and a mirrored prior for trainers. The priors cover:
- goals (for trainers, specialisations)
- coaching style on 4 axes
- modality
- weekly schedule
- budget (for trainers, price)
- experience (for trainers, the level they coach best)
- a Big Five tilt

**Noise.** Each person is drawn from one archetype. Each of the 7 attribute blocks is then independently replaced, with probability noise_rate ~ U(0.25, 0.35), by the same block drawn from a different random archetype. Across `synth-v1` this noises 30% of blocks on average.

What gets stored in `synthetic_profiles`:
- the archetype
- which blocks were noised
- hidden latent traits: a "chemistry" unit vector, motivation and patience

The app and the scoring formula never read that table. Phase 5 uses it only to build a ground-truth compatibility signal that isn't circular.

### Trainer extras
- **Price:** lognormal around the archetype's median, × city multiplier × (1 + 0.03 × years), clipped to ₹300–2,500 per session.
- **Capacity:** `max_clients` is uniform 8–25. `active_clients` is Binomial(max, U(0.2, 0.85)) and stands for existing off-platform clients.
- **Rating:** 1 + 4·Beta(8, 2), so the mean is about 4.2. `rating_count` ~ Poisson(30).
- **Home gym:** the nearest **real** OSM gym within 3 km. 1,158 of 1,200 trainers get one; the rest are NULL.

## Limitations
- Synthetic users validate the pipeline, not real-world matching quality.
- The Big Five rows are real but come from a global online sample. It isn't specifically Indian.
- The body-circumference models are assumptions, calibrated for internal consistency and plausibility (see above).
