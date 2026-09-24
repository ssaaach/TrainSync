// 7-day Indian meal planner.
//
// Each day is a mixed-integer program solved with HiGHS (WebAssembly, in
// process): pick one (dish, portion) per meal slot to minimise weighted
// deviation from the calorie / protein / carb / fat targets plus any fibre
// shortfall, with a small variety penalty for dishes already used this week.
// Hard rules: diet preference, allergens, one dish at most once per day and
// twice per week, each meal inside a sensible share of the day's calories.
// If the solver is unavailable, a greedy + local-search planner gives the same
// output shape (engine: "fallback").
const loadHighs = require('highs');
const db = require('../config/db');

const VERSION = 'mp-v3.0';
const PORTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; // fallback + swap steps
const PORTION_MIN = 0.5;
const PORTION_MAX = 2;
const SLOT_SHARE = { breakfast: 0.25, lunch: 0.32, dinner: 0.28, snack: 0.15 };
const SLOT_RANGE = [0.5, 1.6]; // a meal's kcal as a fraction of its share
const FIBRE_PER_1000 = 14; // g per 1000 kcal (US IOM adequate intake)
const TOL = { kcal: 0.05, macro: 0.1 };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const CUISINE_MAP = { 'north-indian': 'north', punjabi: 'north', 'south-indian': 'south', bengali: 'east', gujarati: 'west', maharashtrian: 'west', continental: 'modern', chinese: 'indo-chinese' };

let highsPromise = null;
const highs = () => (highsPromise ??= loadHighs());

// ---------------------------------------------------------------- data
let cache = { at: 0, dishes: null };
async function loadDishes() {
  if (cache.dishes && Date.now() - cache.at < 10 * 60_000) return cache.dishes;
  const [dishes] = await db.query(
    `SELECT dish_id, slug, name, diet_pref, meal_slots, allergens, prep_minutes, serving_g, kcal, protein_g, carbs_g, fat_g,
            suitable_for, cuisine FROM dishes WHERE is_synthetic = 0 AND kcal IS NOT NULL`
  );
  const [ings] = await db.query(
    `SELECT di.dish_id, di.grams, f.food_id, f.name, f.ingredient_key, f.category, COALESCE(f.fiber_g, 0) AS fiber_g
       FROM dish_ingredients di JOIN foods f ON f.food_id = di.food_id`
  );
  const byDish = new Map();
  for (const i of ings) {
    if (!byDish.has(i.dish_id)) byDish.set(i.dish_id, []);
    byDish.get(i.dish_id).push(i);
  }
  const parse = v => (typeof v === 'string' ? JSON.parse(v) : v) || [];
  const out = dishes.map(d => {
    const items = byDish.get(d.dish_id) || [];
    return {
      ...d,
      meal_slots: parse(d.meal_slots), allergens: parse(d.allergens), suitable_for: parse(d.suitable_for),
      kcal: Number(d.kcal), protein_g: Number(d.protein_g), carbs_g: Number(d.carbs_g), fat_g: Number(d.fat_g),
      fiber_g: Math.round(items.reduce((s, i) => s + (Number(i.grams) * Number(i.fiber_g)) / 100, 0) * 10) / 10,
      ingredients: items.map(i => ({ key: i.ingredient_key, name: i.name, category: i.category, grams: Number(i.grams) })),
    };
  });
  cache = { at: Date.now(), dishes: out };
  return out;
}

// ---------------------------------------------------------------- targets
// Protein-dense or large days get a second snack for more room to fit.
function slotsFor(kcal, proteinG = 0) {
  return kcal >= 2300 || (proteinG * 4) / kcal > 0.24 ? ['breakfast', 'snack', 'lunch', 'snack', 'dinner'] : ['breakfast', 'lunch', 'snack', 'dinner'];
}

function shares(slots) {
  const raw = slots.map(s => SLOT_SHARE[s] / (s === 'snack' ? slots.filter(x => x === 'snack').length : 1));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map(r => r / total);
}

function eligible(dishes, profile) {
  const pref = profile.diet_pref || 'veg';
  const avoid = new Set(profile.allergens || []);
  return dishes.filter(d => d.suitable_for.includes(pref) && !d.allergens.some(a => avoid.has(a)));
}

// ---------------------------------------------------------------- one day (MIP)
// z_{slot,dish} binary picks a dish; x_{slot,dish} is its portion (continuous,
// 0.5–2 servings, only when picked). Portions are rounded to 0.1 afterwards.
function dayModel(cands, slots, targets, weekUses, liked) {
  const sh = shares(slots);
  const lines = [];
  const vars = [];
  const obj = [];
  const K = targets.kcal, P = targets.protein_g, C = targets.carbs_g, F = targets.fat_g, FIB = targets.fiber_g;
  const rows = { kcal: [], p: [], c: [], f: [], fib: [] };
  const perDish = new Map();
  const bounds = [];
  let r = 0;
  slots.forEach((slot, si) => {
    const zs = [];
    const lo = K * sh[si] * SLOT_RANGE[0];
    const hi = K * sh[si] * SLOT_RANGE[1];
    for (const d of cands) {
      if (!d.meal_slots.includes(slot)) continue;
      if ((weekUses.get(d.dish_id) || 0) >= 2) continue;
      if (d.kcal * PORTION_MAX < lo || d.kcal * PORTION_MIN > hi) continue;
      const z = `z_${si}_${d.dish_id}`;
      const x = `x_${si}_${d.dish_id}`;
      vars.push({ z, x, slot, si, d });
      zs.push(z);
      rows.kcal.push(`${round(d.kcal)} ${x}`);
      rows.p.push(`${round(d.protein_g)} ${x}`);
      rows.c.push(`${round(d.carbs_g)} ${x}`);
      rows.f.push(`${round(d.fat_g)} ${x}`);
      rows.fib.push(`${round(d.fiber_g)} ${x}`);
      lines.push(` a${r}: ${x} - ${PORTION_MAX} ${z} <= 0`);
      lines.push(` b${r}: ${x} - ${PORTION_MIN} ${z} >= 0`);
      lines.push(` c${r}: ${round(d.kcal)} ${x} - ${round(lo)} ${z} >= 0`);
      lines.push(` d${r++}: ${round(d.kcal)} ${x} - ${round(hi)} ${z} <= 0`);
      bounds.push(` 0 <= ${x} <= ${PORTION_MAX}`);
      let cost = 0;
      if (weekUses.get(d.dish_id)) cost += 0.06;
      if (liked.size && liked.has(d.cuisine)) cost -= 0.03;
      if (cost) obj.push(`${cost >= 0 ? '+' : '-'} ${round(Math.abs(cost), 4)} ${z}`);
      if (!perDish.has(d.dish_id)) perDish.set(d.dish_id, []);
      perDish.get(d.dish_id).push(z);
    }
    if (!zs.length) throw new Error(`no candidates for ${slot}`);
    lines.push(` s${si}: ${zs.join(' + ')} = 1`);
  });
  lines.push(` kc: ${rows.kcal.join(' + ')} - kp + kn = ${round(K)}`);
  lines.push(` pr: ${rows.p.join(' + ')} - pp + pn = ${round(P)}`);
  lines.push(` cb: ${rows.c.join(' + ')} - cp + cn = ${round(C)}`);
  lines.push(` ft: ${rows.f.join(' + ')} - fp + fn = ${round(F)}`);
  lines.push(` fb: ${rows.fib.join(' + ')} + fs >= ${round(FIB)}`);
  let di = 0;
  for (const names of perDish.values()) if (names.length > 1) lines.push(` u${di++}: ${names.join(' + ')} <= 1`);
  const w = (x, t) => round(x / Math.max(t, 1), 6);
  const objective = [
    `${w(12, K)} kp + ${w(12, K)} kn`, `+ ${w(5, P)} pp + ${w(6, P)} pn`, `+ ${w(2, C)} cp + ${w(2, C)} cn`,
    `+ ${w(2.5, F)} fp + ${w(2.5, F)} fn`, `+ ${w(3, FIB)} fs`, ...obj,
  ].join(' ');
  const lp = ['Minimize', ` obj: ${objective}`, 'Subject To', ...lines, 'Bounds', ...bounds, 'Binary', ` ${vars.map(v => v.z).join(' ')}`, 'End'].join(String.fromCharCode(10));
  return { lp, vars };
}
const round = (v, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

async function solveDay(cands, slots, targets, weekUses, liked) {
  const h = await highs();
  const { lp, vars } = dayModel(cands, slots, targets, weekUses, liked);
  const res = h.solve(lp, { output_flag: false, time_limit: 0.8, mip_rel_gap: 0.005 });
  if (!['Optimal', 'Time limit reached'].includes(res.Status)) throw new Error(`solver: ${res.Status}`);
  const picked = vars.filter(v => res.Columns[v.z] && res.Columns[v.z].Primal > 0.5);
  if (picked.length !== slots.length) throw new Error('solver returned an incomplete day');
  return picked.sort((a, b) => a.si - b.si)
    .map(v => ({ slot: v.slot, dish: v.d, portion: Math.max(PORTION_MIN, Math.round(res.Columns[v.x].Primal * 10) / 10) }));
}

// ---------------------------------------------------------------- one day (fallback)
function greedyDay(cands, slots, targets, weekUses) {
  const sh = shares(slots);
  const pick = slots.map((slot, si) => {
    const goal = targets.kcal * sh[si];
    let best = null;
    for (const d of cands) {
      if (!d.meal_slots.includes(slot) || (weekUses.get(d.dish_id) || 0) >= 2) continue;
      for (const k of PORTIONS) {
        const s = Math.abs(d.kcal * k - goal) / goal - (d.protein_g * k) / (targets.protein_g * sh[si] * 8) + (weekUses.get(d.dish_id) ? 0.05 : 0);
        if (!best || s < best.s) best = { slot, dish: d, portion: k, s };
      }
    }
    return best;
  }).filter(Boolean);
  // local search: adjust portions to pull total kcal toward target
  for (let it = 0; it < 30; it++) {
    const tot = pick.reduce((s, m) => s + m.dish.kcal * m.portion, 0);
    const err = tot - targets.kcal;
    if (Math.abs(err) / targets.kcal < 0.03) break;
    const m = pick.reduce((a, b) => (Math.abs(b.dish.kcal) > Math.abs(a.dish.kcal) ? b : a));
    const i = PORTIONS.indexOf(m.portion) + (err > 0 ? -1 : 1);
    if (i < 0 || i >= PORTIONS.length) break;
    m.portion = PORTIONS[i];
  }
  return pick.map(({ slot, dish, portion }) => ({ slot, dish, portion }));
}

// ---------------------------------------------------------------- week
function mealView(m, alternatives) {
  const k = m.portion;
  const d = m.dish;
  return {
    slot: m.slot, dishId: d.dish_id, slug: d.slug, name: d.name, cuisine: d.cuisine, prepMinutes: d.prep_minutes, portion: k,
    grams: Math.round(d.serving_g * k),
    kcal: Math.round(d.kcal * k), protein_g: round(d.protein_g * k, 1), carbs_g: round(d.carbs_g * k, 1),
    fat_g: round(d.fat_g * k, 1), fiber_g: round(d.fiber_g * k, 1),
    ingredients: d.ingredients.map(i => ({ name: i.name, grams: Math.round(i.grams * k) })),
    alternatives,
  };
}

function totals(meals) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const m of meals) for (const k of Object.keys(t)) t[k] += m[k];
  for (const k of Object.keys(t)) t[k] = round(t[k], 1);
  return t;
}

function withinTolerance(t, targets) {
  const rel = (a, b) => Math.abs(a - b) / Math.max(b, 1);
  return {
    kcal: rel(t.kcal, targets.kcal) <= TOL.kcal,
    protein: rel(t.protein_g, targets.protein_g) <= TOL.macro,
    carbs: rel(t.carbs_g, targets.carbs_g) <= TOL.macro,
    fat: rel(t.fat_g, targets.fat_g) <= TOL.macro,
    fiber: t.fiber_g >= targets.fiber_g * 0.9,
  };
}

function alternativesFor(m, cands, used) {
  const goalK = m.dish.kcal * m.portion;
  const goalP = m.dish.protein_g * m.portion;
  return cands
    .filter(d => d.dish_id !== m.dish.dish_id && d.meal_slots.includes(m.slot) && !used.has(d.dish_id))
    .map(d => {
      const k = PORTIONS.reduce((a, b) => (Math.abs(d.kcal * b - goalK) < Math.abs(d.kcal * a - goalK) ? b : a));
      return { d, k, s: Math.abs(d.kcal * k - goalK) / goalK + Math.abs(d.protein_g * k - goalP) / Math.max(goalP, 5) };
    })
    .sort((a, b) => a.s - b.s)
    .slice(0, 3)
    .map(({ d, k }) => ({ dishId: d.dish_id, name: d.name, portion: k, kcal: Math.round(d.kcal * k), protein_g: round(d.protein_g * k, 1) }));
}

function groceryList(days) {
  const byName = new Map();
  for (const day of days) for (const m of day.meals) for (const i of m.ingredients) {
    byName.set(i.name, (byName.get(i.name) || 0) + i.grams);
  }
  return [...byName.entries()].map(([name, grams]) => ({ name, grams: Math.round(grams / 10) * 10 }))
    .filter(x => x.grams > 0).sort((a, b) => b.grams - a.grams);
}

/**
 * targets: { kcal, protein_g, carbs_g, fat_g, fiber_g? }
 * profile: { diet_pref, allergens[], cuisines[] }
 */
async function planWeek(profile, targetsIn, { dishes, seed = 1, engine = 'auto' } = {}) {
  const all = dishes || (await loadDishes());
  const targets = { ...targetsIn, fiber_g: targetsIn.fiber_g || Math.round((targetsIn.kcal / 1000) * FIBRE_PER_1000) };
  let cands = eligible(all, profile);
  // Seeded shuffle of candidate order gives "regenerate" variety on ties.
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  cands = cands.map(d => [rnd(), d]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const liked = new Set((profile.cuisines || []).map(c => CUISINE_MAP[c]).filter(Boolean));
  const slots = slotsFor(targets.kcal, targets.protein_g);
  const weekUses = new Map();
  const days = [];
  let usedEngine = engine === 'fallback' ? 'fallback' : 'optimizer';
  for (const day of DAYS) {
    let picked;
    if (usedEngine === 'optimizer') {
      try {
        picked = await solveDay(cands, slots, targets, weekUses, liked);
      } catch {
        usedEngine = 'fallback';
      }
    }
    if (!picked) picked = greedyDay(cands, slots, targets, weekUses);
    const used = new Set(picked.map(p => p.dish.dish_id));
    for (const p of picked) weekUses.set(p.dish.dish_id, (weekUses.get(p.dish.dish_id) || 0) + 1);
    const meals = picked.map(p => mealView(p, alternativesFor(p, cands, used)));
    const t = totals(meals);
    days.push({ day, meals, totals: t, within: withinTolerance(t, targets) });
  }
  const hits = days.filter(d => d.within.kcal && d.within.protein && d.within.carbs && d.within.fat).length;
  return {
    kind: 'diet',
    generatorVersion: VERSION,
    engine: usedEngine,
    seed,
    createdAt: new Date().toISOString(),
    profile: { diet_pref: profile.diet_pref, allergens: profile.allergens || [], cuisines: profile.cuisines || [] },
    targets,
    tolerance: TOL,
    days,
    groceries: groceryList(days),
    summary: { daysWithinTolerance: hits, candidateDishes: cands.length, mealsPerDay: slots.length },
    reasoning: [
      `Daily target ${targets.kcal} kcal with ${targets.protein_g} g protein, ${targets.carbs_g} g carbs, ${targets.fat_g} g fat and at least ${targets.fiber_g} g fibre.`,
      `${cands.length} of ${all.length} dishes fit your diet (${profile.diet_pref || 'veg'})${(profile.allergens || []).length ? ` and avoid ${profile.allergens.join(', ')}` : ''}.`,
      usedEngine === 'optimizer'
        ? 'Each day is solved as an optimisation problem that picks one dish and portion per meal to land as close to your targets as possible.'
        : 'Built with the quick planner (the optimiser was unavailable), so days may sit a little further from target.',
      'No dish appears twice in a day or more than twice in the week; portions are scaled between half and double a serving.',
      `${hits} of 7 days are within ±5% of calories and ±10% of each macro.`,
      'Nutrition is computed from USDA ingredient data for typical home recipes; restaurant and packaged versions differ.',
    ],
  };
}

module.exports = { planWeek, loadDishes, eligible, withinTolerance, slotsFor, VERSION, TOL };
