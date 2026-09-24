// Computes a dish's macros, diet labels and allergens from its ingredient
// grams and the per-100 g `foods` rows. Pure: no DB access.

const DIET_ORDER = ['vegan', 'veg', 'eggetarian', 'non-veg'];
const ANIMAL = { meat: 3, fish: 3, shellfish: 3, egg: 2, dairy: 1, honey: 1, plant: 0 };

/**
 * @param {Record<string, number>} grams   ingredient_key -> grams per serving
 * @param {Map<string, object>} foodsByKey ingredient_key -> foods row
 * @returns {{serving_g, kcal, protein_g, carbs_g, fat_g, diet_pref, suitable_for, allergens}}
 */
function analyseDish(grams, foodsByKey) {
  let kcal = 0, protein = 0, carbs = 0, fat = 0, serving = 0;
  let animalLevel = 0;
  let jainOk = true;
  const allergens = new Set();

  for (const [key, g] of Object.entries(grams)) {
    const food = foodsByKey.get(key);
    if (!food) throw new Error(`Unknown ingredient "${key}"`);
    if (!(g > 0)) throw new Error(`Ingredient "${key}" needs a positive gram amount`);
    const f = g / 100;
    kcal += Number(food.kcal) * f;
    protein += Number(food.protein_g) * f;
    carbs += Number(food.carbs_g) * f;
    fat += Number(food.fat_g) * f;
    serving += g;
    animalLevel = Math.max(animalLevel, ANIMAL[food.diet_class] ?? 0);
    if (food.jain_excluded || ANIMAL[food.diet_class] >= 2) jainOk = false;
    for (const a of parseList(food.allergens)) allergens.add(a);
  }

  // 0 plant-only → vegan, 1 dairy/honey → veg, 2 egg → eggetarian, 3 meat/fish → non-veg
  const dietPref = DIET_ORDER[animalLevel];
  const suitable = DIET_ORDER.slice(animalLevel);
  if (jainOk) suitable.push('jain');

  const r1 = v => Math.round(v * 10) / 10;
  return {
    serving_g: r1(serving),
    kcal: r1(kcal),
    protein_g: r1(protein),
    carbs_g: r1(carbs),
    fat_g: r1(fat),
    diet_pref: dietPref,
    suitable_for: suitable,
    allergens: [...allergens].sort(),
  };
}

function parseList(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : JSON.parse(v);
}

module.exports = { analyseDish };
