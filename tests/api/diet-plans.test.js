// Diet planner: API, hard rules (diet + allergens + variety) and tolerance rate.
const app = require('../../app');
const db = require('../../config/db');
const { store } = require('../../config/session');
const mp = require('../../services/mealPlanner');
const bc = require('../../services/bodyComposition');
const { client, resetRateLimits } = require('../setup/client');
const { onboardedClient } = require('../setup/onboard');

const DOMAIN = '@diet.trainsync.test';
jest.setTimeout(240_000);

async function cleanup() {
  await resetRateLimits(db);
  await db.query('DELETE FROM users WHERE email LIKE ?', [`%${DOMAIN}`]);
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await store.close();
  await db.end();
});

test('preview: diet, allergens and variety rules always hold', async () => {
  const res = await client(app).post('/api/plans/diet/preview', {
    sex: 'female', age: 28, height_cm: 160, weight_kg: 62, activity_level: 'light', goal: 'cut', diet_pref: 'vegan', allergens: ['peanuts', 'soy'],
  });
  expect(res.status).toBe(200);
  const plan = res.body.plan;
  expect(plan.days).toHaveLength(7);
  const dishes = new Map((await mp.loadDishes()).map(d => [d.dish_id, d]));
  const weekCount = new Map();
  for (const day of plan.days) {
    const ids = day.meals.map(m => m.dishId);
    expect(new Set(ids).size).toBe(ids.length); // no same-day repeats
    for (const m of day.meals) {
      const d = dishes.get(m.dishId);
      expect(d.suitable_for).toContain('vegan');
      expect(d.allergens).not.toContain('peanuts');
      expect(d.allergens).not.toContain('soy');
      weekCount.set(m.dishId, (weekCount.get(m.dishId) || 0) + 1);
    }
  }
  expect(Math.max(...weekCount.values())).toBeLessThanOrEqual(2);
  expect(plan.groceries.length).toBeGreaterThan(5);
});

test('trainee plan from profile, then swap a meal', async () => {
  const api = await onboardedClient(app, { email: `d1${DOMAIN}` });
  const gen = await api.post('/api/plans/diet', {});
  expect(gen.status).toBe(201);
  const { planId, plan } = gen.body;
  expect(plan.targets.general).toBeUndefined(); // body metrics shared -> personal targets
  const meal = plan.days[0].meals[0];
  const alt = meal.alternatives[0];
  const sw = await api.post(`/api/plans/diet/${planId}/swap`, { day: plan.days[0].day, meal: 0, dishId: alt.dishId });
  expect(sw.status).toBe(200);
  expect(sw.body.day.meals[0].dishId).toBe(alt.dishId);
  expect((await api.post(`/api/plans/diet/${planId}/swap`, { day: 'mon', meal: 0, dishId: 999999 })).status).toBe(400);
  expect((await api.get('/api/plans/diet/active')).body.planId).toBe(planId);
});

test('without body-metrics consent the plan uses general targets', async () => {
  const api = await onboardedClient(app, { email: `d2${DOMAIN}`, consents: { body_metrics: false } });
  const res = await api.post('/api/plans/diet', {});
  expect(res.body.plan.targets.general).toBe(true);
});

test('tolerance rate over 40 random profiles (reported)', async () => {
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const prefs = ['veg', 'vegan', 'non-veg', 'eggetarian', 'jain'];
  const goals = ['cut', 'lean-bulk', 'bulk', 'maintenance'];
  let hit = 0;
  let days = 0;
  for (let i = 0; i < 40; i++) {
    const sex = rnd() < 0.5 ? 'male' : 'female';
    const t = bc.energyTargets({ sex, weightKg: 50 + rnd() * 45, heightCm: 150 + rnd() * 35, age: 20 + Math.floor(rnd() * 35), activityLevel: 'moderate', goal: goals[i % 4] }).targets;
    const plan = await mp.planWeek({ diet_pref: prefs[i % 5] }, t, { seed: i + 1 });
    hit += plan.summary.daysWithinTolerance;
    days += 7;
  }
  const rate = hit / days;
  console.log(`meal planner: ${(rate * 100).toFixed(1)}% of days within ±5% kcal and ±10% each macro (40 profiles)`);
  expect(rate).toBeGreaterThan(0.7);
});
