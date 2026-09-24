#!/usr/bin/env node
// npm run import:foods [-- --refresh]
// Imports USDA FoodData Central SR Legacy (CC0) nutrients per 100 g:
//   1. every ingredient in db/seeds/food_manifest.json (used by the dish seeds),
//   2. extra plain staples from the relevant USDA categories, up to
//      config foods.targetTotal (~400 rows).
// Upserts on ingredient_key. If USDA is unreachable and nothing is cached the
// import stops: nutrient values are never invented, not even as a flagged fallback.
const db = require('../../config/db');
const config = require('../../config');
const manifest = require('../../db/seeds/food_manifest.json');
const { loadSrLegacy } = require('./usda');
const { parseArgs } = require('./lib');

const EXTRA_CATEGORIES = [
  'Cereal Grains and Pasta', 'Legumes and Legume Products', 'Dairy and Egg Products', 'Poultry Products',
  'Finfish and Shellfish Products', 'Vegetables and Vegetable Products', 'Fruits and Fruit Juices',
  'Nut and Seed Products', 'Fats and Oils', 'Spices and Herbs',
];
const EXTRA_INCLUDE = /(, raw\b|, dry\b|, dried\b|cooked, boiled, drained, without salt|, fluid\b|, whole\b)/i;
const EXTRA_EXCLUDE = /(babyfood|with salt|canned|frozen|syrup|juice|fried|imitation|restaurant|includes foods for|nectar|pickled|breaded|glazed|sweetened|candied|[A-Z]{4,})/;

const CLASS_BY_CATEGORY = {
  'Dairy and Egg Products': d => (/^egg/i.test(d) ? 'egg' : 'dairy'),
  'Poultry Products': () => 'meat',
  'Finfish and Shellfish Products': d => (/^crustaceans|^mollusks/i.test(d) ? 'shellfish' : 'fish'),
};

const round = (v, dp) => (v == null ? null : Number(Number(v).toFixed(dp)));

function pickExtras(sr, usedFdc, count) {
  const byCat = new Map(EXTRA_CATEGORIES.map(c => [c, []]));
  for (const f of sr.values()) {
    if (!byCat.has(f.category) || usedFdc.has(f.fdc_id)) continue;
    if (!EXTRA_INCLUDE.test(f.description) || EXTRA_EXCLUDE.test(f.description)) continue;
    if (f.kcal == null || f.protein == null || f.fat == null || f.carbs == null) continue;
    byCat.get(f.category).push(f);
  }
  for (const list of byCat.values()) list.sort((a, b) => a.description.localeCompare(b.description));
  // Round-robin across categories so every food group is represented.
  const picked = [];
  for (let i = 0; picked.length < count; i++) {
    let any = false;
    for (const list of byCat.values()) {
      if (i < list.length && picked.length < count) { picked.push(list[i]); any = true; }
    }
    if (!any) break;
  }
  return picked;
}

async function main() {
  const args = parseArgs();
  let sr;
  try {
    sr = await loadSrLegacy({ refresh: Boolean(args.refresh) });
  } catch (err) {
    console.error(`✖ USDA FoodData Central unreachable (${err.message}) and no cached copy.`);
    console.error('  Foods were NOT imported. Nutrient values are never invented; re-run when online.');
    process.exit(2);
  }

  const idx = Object.fromEntries(manifest.fields.map((f, i) => [f, i]));
  const rows = [];
  const missing = [];
  for (const item of manifest.items) {
    const fdc = item[idx.fdc_id];
    const f = sr.get(fdc);
    if (!f) { missing.push(`${item[idx.key]} (fdc ${fdc})`); continue; }
    rows.push([
      item[idx.key], fdc, item[idx.name], f.category, round(f.kcal, 1), round(f.protein, 2), round(f.carbs, 2),
      round(f.fat, 2), round(f.fiber, 2), 'usda-sr-legacy', 0, f.description.slice(0, 255), item[idx.proxy_note],
      item[idx.diet_class], item[idx.jain_excluded], JSON.stringify(item[idx.allergens]), 0,
    ]);
  }
  if (missing.length) throw new Error(`Manifest fdc_ids not found in SR Legacy: ${missing.join(', ')}`);

  const usedFdc = new Set(manifest.items.map(i => i[idx.fdc_id]));
  const target = config.foods.targetTotal;
  for (const f of pickExtras(sr, usedFdc, Math.max(0, target - rows.length))) {
    const cls = (CLASS_BY_CATEGORY[f.category] || (() => 'plant'))(f.description);
    rows.push([
      `fdc_${f.fdc_id}`, f.fdc_id, f.description.slice(0, 255), f.category, round(f.kcal, 1), round(f.protein, 2),
      round(f.carbs, 2), round(f.fat, 2), round(f.fiber, 2), 'usda-sr-legacy', 0, f.description.slice(0, 255), null,
      cls, 0, JSON.stringify(cls === 'dairy' ? ['dairy'] : cls === 'egg' ? ['egg'] : cls === 'fish' ? ['fish'] : cls === 'shellfish' ? ['shellfish'] : []), 1,
    ]);
  }

  const conn = await db.getConnection();
  try {
    await conn.query(
      `INSERT INTO foods (ingredient_key, fdc_id, name, category, kcal, protein_g, carbs_g, fat_g, fiber_g, source,
         is_synthetic, usda_description, proxy_note, diet_class, jain_excluded, allergens, is_staple_extra)
       VALUES ?
       ON DUPLICATE KEY UPDATE fdc_id = VALUES(fdc_id), name = VALUES(name), category = VALUES(category),
         kcal = VALUES(kcal), protein_g = VALUES(protein_g), carbs_g = VALUES(carbs_g), fat_g = VALUES(fat_g),
         fiber_g = VALUES(fiber_g), source = VALUES(source), usda_description = VALUES(usda_description),
         proxy_note = VALUES(proxy_note), diet_class = VALUES(diet_class), jain_excluded = VALUES(jain_excluded),
         allergens = VALUES(allergens), is_staple_extra = VALUES(is_staple_extra)`,
      [rows]
    );
    const [[c]] = await conn.query(
      'SELECT COUNT(*) total, SUM(is_staple_extra = 0) manifest, SUM(proxy_note IS NOT NULL) proxies FROM foods'
    );
    console.log(`✔ foods: ${c.total} rows (${c.manifest} dish ingredients incl. ${c.proxies} documented proxies, ` +
      `${c.total - c.manifest} extra staples) from USDA FoodData Central SR Legacy (CC0)`);
  } finally {
    conn.release();
    await db.end();
  }
}

main().catch(err => { console.error('import:foods failed:', err.message); process.exit(1); });
