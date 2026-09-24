# Data sources

Every external dataset is downloaded by a script under `scripts/import/` and cached in `ml/data/raw/`, which git ignores. If a source is unreachable, the importer says so clearly. It never stores made-up data under a real source's label.

| Domain | Source | License | Importer | What's in the DB |
|---|---|---|---|---|
| Exercises | **free-exercise-db** by yuhonas: https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json, images under `.../main/exercises/` | Unlicense (public domain) | `npm run import:exercises` | 876 rows in `exercises` (`source='free-exercise-db'`), plus a derived `movement_pattern` and `is_compound` (`scripts/import/movementPatterns.js`). If the source is unreachable, a 24-row fallback set is loaded with `is_synthetic=1` |
| Gyms | **OpenStreetMap** via the Overpass API (`leisure=fitness_centre`, `amenity=gym`, `out center tags;`) for Bengaluru, Mumbai, Delhi, Chennai, Hyderabad and Pune | ODbL 1.0 | `npm run import:gyms [-- --city=bengaluru]` | 650 rows (`source='osm'`), upserted on `osm_id`. Requests are at least 2 s apart, honour `Retry-After`, and responses are cached. Manual rows (`source='manual'`, 59) are never touched |
| Localities | **OpenStreetMap Nominatim** geocoding of 102 curated neighbourhood names | ODbL 1.0 | `npm run import:localities` | `db/seeds/localities.csv` (committed), loaded by `npm run seed` |
| Personality (synthetic users only) | **Open Psychometrics IPIP-FFM**: https://openpsychometrics.org/_rawdata/IPIP-FFM-data-8Nov2018.zip | Public raw-data release | `npm run import:ipip` | Not stored in MySQL. Scored rows are cached as `ml/data/raw/ipip/ipip_ffm_scored.npz` and sampled by the generator |
| Personality questionnaire shown to users | **Mini-IPIP**, 20 items (Donnellan et al., 2006), drawn from the public-domain IPIP | Public domain | none | `config/mini_ipip.json` |
| Food nutrients | **USDA FoodData Central, SR Legacy** (April 2018 CSV): https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip | CC0 1.0 | `npm run import:foods` | 402 rows in `foods`. That's 155 ingredients referenced by dishes, 17 of them documented proxies (see below), plus 247 plain staples |
| Pincode → lat/lng | *All India Pincode Directory* (data.gov.in) | OGDL-India | **not imported** | This optional source needs a data.gov.in API key. Onboarding uses the locality table and browser geolocation instead |

## Attribution text

- **Maps and gyms** (required wherever OSM data is shown): `© OpenStreetMap contributors` with a link to https://www.openstreetmap.org/copyright (ODbL).
- **Exercises:** "Exercise data and images: free-exercise-db (public domain)".
- **Nutrition:** "Nutrient data: USDA FoodData Central, SR Legacy (CC0)".
- **Personality items:** "Mini-IPIP (Donnellan et al., 2006), items from the International Personality Item Pool (ipip.ori.org), public domain".

## Food proxies

SR Legacy has no exact entry for some Indian staples. For each of these, the manifest maps the ingredient to the closest USDA food and records a `proxy_note`, which is stored in `foods.proxy_note`:

| Ingredient | USDA food used |
|---|---|
| Paneer | queso blanco (an acid-set fresh cheese) |
| Poha | raw white rice |
| Ragi | millet |
| Soya chunks | defatted soy flour |
| Methi (fenugreek leaves) | spinach |
| Jaggery | brown sugar |
| Garam masala | curry powder |

The rest of the 17 are in `db/seeds/food_manifest.json`. The manifest itself is the list of FDC IDs.

## Curated (not external) data

- **Dishes** (`db/seeds/dishes.js`): 182 common Indian dishes. Each is written down as grams per ingredient for one serving. Those proportions are my estimates of typical home recipes, not lab measurements. Everything else is **computed** from the USDA ingredients (`services/dishNutrition.js`): kcal and macros, `diet_pref`, `suitable_for` (vegan / veg / eggetarian / non-veg / jain) and allergens.
- **Synthetic people:** see `ml/README.md`. All of them are `is_synthetic = 1`.
