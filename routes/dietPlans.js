// /api/plans/diet
//   POST /preview   public: 7-day plan from a short form (nothing saved)
//   POST /          trainee: plan from the profile's targets, saved as active
//   GET  /active    trainee: active plan
//   POST /:id/swap  replace one meal with one of its listed alternatives
const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const vocab = require('../config/profile_vocab.json');
const bc = require('../services/bodyComposition');
const mp = require('../services/mealPlanner');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { badRequest, notFound } = require('../middleware/errors');
const { loadTraineeProfile } = require('../services/profileLoader');

const router = express.Router();

// Targets without body metrics: typical adult needs, adjusted for the goal.
function generalTargets(sex, goal = 'maintenance') {
  const base = sex === 'male' ? 2300 : 1850;
  const adj = { cut: -0.15, 'lean-bulk': 0.07, bulk: 0.12, maintenance: 0 }[goal] || 0;
  const kcal = Math.round(base * (1 + adj));
  const protein = Math.round((kcal * (goal === 'cut' ? 0.25 : 0.2)) / 4);
  const fat = Math.round((kcal * 0.28) / 9);
  return { kcal, protein_g: protein, fat_g: fat, carbs_g: Math.round((kcal - protein * 4 - fat * 9) / 4), general: true };
}

function targetsFor(p) {
  if (p.weight_kg && p.height_cm && p.age && p.sex) {
    return bc.energyTargets({
      sex: p.sex, weightKg: Number(p.weight_kg), heightCm: Number(p.height_cm), age: p.age,
      activityLevel: p.activity_level || 'moderate', goal: p.goal || 'maintenance',
    }).targets;
  }
  return generalTargets(p.sex, p.goal);
}

const previewSchema = z.object({
  sex: z.enum(['male', 'female']),
  age: z.coerce.number().int().min(18).max(100),
  height_cm: z.coerce.number().min(120).max(230),
  weight_kg: z.coerce.number().min(30).max(250),
  activity_level: z.enum(vocab.activityLevels),
  goal: z.enum(vocab.bodyGoals),
  diet_pref: z.enum(vocab.dietPrefs),
  allergens: z.array(z.enum(vocab.allergens)).max(vocab.allergens.length).default([]),
  cuisines: z.array(z.enum(vocab.cuisines)).max(vocab.cuisines.length).default([]),
  seed: z.coerce.number().int().min(1).max(2 ** 31 - 1).optional(),
});

router.post('/preview', validate({ body: previewSchema }), async (req, res, next) => {
  try {
    const { seed, ...p } = req.valid.body;
    const plan = await mp.planWeek(p, targetsFor(p), { seed: seed || 1 });
    res.json({ plan, preview: true });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('trainee'), validate({ body: z.object({ seed: z.coerce.number().int().min(1).optional() }) }), async (req, res, next) => {
  const user = req.session.user;
  try {
    const p = await loadTraineeProfile(user.user_id);
    if (!p || !p.diet_pref) throw badRequest('Finish "Goals & training" in your profile first.', 'profile_incomplete');
    const seed = req.valid.body.seed || (Math.floor(Math.random() * 2 ** 31) || 1);
    const plan = await mp.planWeek(p, targetsFor(p), { seed });
    const planId = await db.withTransaction(async conn => {
      await conn.query("UPDATE user_plans SET is_active = 0 WHERE user_id = ? AND kind = 'diet'", [user.user_id]);
      const [r] = await conn.query(
        "INSERT INTO user_plans (user_id, kind, plan, generator_version, seed, is_active) VALUES (?, 'diet', ?, ?, ?, 1)",
        [user.user_id, JSON.stringify(plan), plan.generatorVersion, seed]
      );
      return r.insertId;
    });
    res.status(201).json({ planId, plan });
  } catch (err) {
    next(err);
  }
});

router.get('/active', requireAuth, async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      "SELECT plan_id, plan, created_at FROM user_plans WHERE user_id = ? AND kind = 'diet' AND is_active = 1 ORDER BY plan_id DESC LIMIT 1",
      [req.session.user.user_id]
    );
    if (!row) return res.json({ plan: null });
    res.set('Cache-Control', 'no-store').json({ planId: row.plan_id, plan: typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan, createdAt: row.created_at });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/swap', requireAuth, validate({ body: z.object({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), meal: z.coerce.number().int().min(0).max(6), dishId: z.coerce.number().int().positive(),
}) }), async (req, res, next) => {
  try {
    const [[row]] = await db.query("SELECT plan_id, plan FROM user_plans WHERE plan_id = ? AND user_id = ? AND kind = 'diet'", [req.params.id, req.session.user.user_id]);
    if (!row) throw notFound('Plan not found');
    const plan = typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan;
    const { day, meal, dishId } = req.valid.body;
    const d = plan.days.find(x => x.day === day);
    const m = d && d.meals[meal];
    const alt = m && m.alternatives.find(a => a.dishId === dishId);
    if (!alt) throw badRequest('That dish is not one of the alternatives for this meal.', 'invalid_swap');
    const dish = (await mp.loadDishes()).find(x => x.dish_id === dishId);
    const k = alt.portion;
    const r1 = v => Math.round(v * 10) / 10;
    d.meals[meal] = {
      slot: m.slot, dishId, slug: dish.slug, name: dish.name, cuisine: dish.cuisine, prepMinutes: dish.prep_minutes, portion: k,
      grams: Math.round(dish.serving_g * k), kcal: Math.round(dish.kcal * k), protein_g: r1(dish.protein_g * k), carbs_g: r1(dish.carbs_g * k),
      fat_g: r1(dish.fat_g * k), fiber_g: r1(dish.fiber_g * k), ingredients: dish.ingredients.map(i => ({ name: i.name, grams: Math.round(i.grams * k) })),
      alternatives: [{ dishId: m.dishId, name: m.name, portion: m.portion, kcal: m.kcal, protein_g: m.protein_g }, ...m.alternatives.filter(a => a.dishId !== dishId)].slice(0, 3),
    };
    const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
    for (const x of d.meals) for (const key of Object.keys(t)) t[key] += x[key];
    for (const key of Object.keys(t)) t[key] = r1(t[key]);
    d.totals = t;
    d.within = mp.withinTolerance(t, plan.targets);
    const byName = new Map();
    for (const day2 of plan.days) for (const x of day2.meals) for (const i of x.ingredients) byName.set(i.name, (byName.get(i.name) || 0) + i.grams);
    plan.groceries = [...byName].map(([name, grams]) => ({ name, grams: Math.round(grams / 10) * 10 })).sort((a, b) => b.grams - a.grams);
    await db.query('UPDATE user_plans SET plan = ? WHERE plan_id = ?', [JSON.stringify(plan), row.plan_id]);
    res.json({ day: d, groceries: plan.groceries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.targetsFor = targetsFor;
