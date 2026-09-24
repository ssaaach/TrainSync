// Reads the cached USDA FoodData Central SR Legacy CSV zip into a compact
// in-memory index: fdc_id -> { description, category, kcal, protein, fat, carbs, fiber } per 100 g.
const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { cachedDownload } = require('./lib');

const SR_LEGACY_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';
const NUTRIENTS = { 1008: 'kcal', 1003: 'protein', 1004: 'fat', 1005: 'carbs', 1079: 'fiber' };

function readCsv(zip, name) {
  const entry = zip.getEntries().find(e => path.posix.basename(e.entryName) === name);
  if (!entry) throw new Error(`${name} missing from USDA archive`);
  return parse(entry.getData().toString('utf8'), { columns: true, skip_empty_lines: true });
}

async function loadSrLegacy({ refresh = false } = {}) {
  const file = await cachedDownload(SR_LEGACY_URL, 'usda/FoodData_Central_sr_legacy_food_csv_2018-04.zip', { refresh });
  const zip = new AdmZip(file);
  const categories = new Map(readCsv(zip, 'food_category.csv').map(c => [c.id, c.description]));
  const foods = new Map();
  for (const f of readCsv(zip, 'food.csv')) {
    foods.set(Number(f.fdc_id), { fdc_id: Number(f.fdc_id), description: f.description, category: categories.get(f.food_category_id) || null });
  }
  // food_nutrient.csv is ~36 MB; scan it line by line instead of parsing every column.
  const entry = zip.getEntries().find(e => path.posix.basename(e.entryName) === 'food_nutrient.csv');
  const text = entry.getData().toString('utf8');
  let start = text.indexOf('\n') + 1;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const cols = text.slice(start, end).split('","');
    start = end + 1;
    if (cols.length < 4) continue;
    const key = NUTRIENTS[cols[2]];
    if (!key) continue;
    const food = foods.get(Number(cols[1]));
    if (food) food[key] = Number(cols[3]);
  }
  return foods;
}

module.exports = { loadSrLegacy, SR_LEGACY_URL };
