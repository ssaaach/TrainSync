// Seeds curated reference data: localities (from the committed CSV) and
// dishes (macros computed from foods). Idempotent: upserts by natural key.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { analyseDish } = require('../../services/dishNutrition');

const SEEDS = path.join(__dirname, '..', '..', 'db', 'seeds');
const SLOT = { B: 'breakfast', L: 'lunch', S: 'snack', D: 'dinner' };

async function seedLocalities(conn) {
  const rows = parse(fs.readFileSync(path.join(SEEDS, 'localities.csv'), 'utf8'), { columns: true, skip_empty_lines: true });
  await conn.query(
    `INSERT INTO localities (city, name, lat, lng, osm_id, source) VALUES ?
     ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng), osm_id = VALUES(osm_id), source = VALUES(source)`,
    [rows.map(r => [r.city, r.name, r.lat, r.lng, r.osm_id || null, r.source])]
  );
  return rows.length;
}

async function seedDishes(conn) {
  const [foods] = await conn.query('SELECT food_id, ingredient_key, kcal, protein_g, carbs_g, fat_g, diet_class, jain_excluded, allergens FROM foods');
  if (!foods.length) throw new Error('The foods table is empty. Run `npm run import:foods` first.');
  const byKey = new Map(foods.map(f => [f.ingredient_key, f]));
  const dishes = require(path.join(SEEDS, 'dishes.js'));

  const slugs = new Set();
  for (const [slug, name, slots, prep, cuisine, grams] of dishes) {
    if (slugs.has(slug)) throw new Error(`Duplicate dish slug "${slug}"`);
    slugs.add(slug);
    const a = analyseDish(grams, byKey);
    const mealSlots = [...slots].map(s => SLOT[s]);
    await conn.query(
      `INSERT INTO dishes (slug, name, diet_pref, meal_slots, allergens, prep_minutes, serving_g, kcal, protein_g, carbs_g, fat_g,
         source, is_synthetic, suitable_for, cuisine)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'curated', 0, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), diet_pref = VALUES(diet_pref), meal_slots = VALUES(meal_slots),
         allergens = VALUES(allergens), prep_minutes = VALUES(prep_minutes), serving_g = VALUES(serving_g), kcal = VALUES(kcal),
         protein_g = VALUES(protein_g), carbs_g = VALUES(carbs_g), fat_g = VALUES(fat_g), suitable_for = VALUES(suitable_for),
         cuisine = VALUES(cuisine)`,
      [slug, name, a.diet_pref, JSON.stringify(mealSlots), JSON.stringify(a.allergens), prep, a.serving_g, a.kcal,
        a.protein_g, a.carbs_g, a.fat_g, JSON.stringify(a.suitable_for), cuisine]
    );
    const [[{ dish_id: dishId }]] = await conn.query('SELECT dish_id FROM dishes WHERE slug = ?', [slug]);
    await conn.query('DELETE FROM dish_ingredients WHERE dish_id = ?', [dishId]);
    await conn.query('INSERT INTO dish_ingredients (dish_id, food_id, grams) VALUES ?',
      [Object.entries(grams).map(([k, g]) => [dishId, byKey.get(k).food_id, g])]);
  }
  return dishes.length;
}

module.exports = { seedLocalities, seedDishes };
