// v3 Phase D: workout plan API (preview, generate, active, swap, logs, adapt)
// and consent-gated safety.
const app = require('../../app');
const db = require('../../config/db');
const { store } = require('../../config/session');
const { client, resetRateLimits } = require('../setup/client');
const { onboardedClient } = require('../setup/onboard');

const DOMAIN = '@plans.trainsync.test';

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

test('public preview builds a cautious plan without saving anything', async () => {
  const res = await client(app).post('/api/plans/workout/preview', {
    goal: 'cut', goals: ['fat-loss'], experience_level: 'beginner', days_per_week: 3, session_minutes: 45, equipment: ['dumbbell'], limitations: ['knee'],
  });
  expect(res.status).toBe(200);
  expect(res.body.preview).toBe(true);
  expect(res.body.plan.summary.split).toBe('Full body (A/B/C)');
  expect(res.body.plan.summary.rpeCap).toBe(7); // health not shared -> cautious
  expect(res.body.plan.safety.notices.join(' ')).toMatch(/shared health/);
  const names = Object.values(res.body.plan.sessions).flatMap(s => s.exercises.map(e => e.name)).join(' ');
  expect(names).not.toMatch(/lunge|jump/i);
  expect(Object.keys(res.body.weeks[0].rx.FB_A).length).toBeGreaterThan(2);
  expect(res.body.weeks).toHaveLength(res.body.plan.summary.weeks);
  expect((await client(app).post('/api/plans/workout/preview', { goal: 'x' })).status).toBe(400);
});

describe('trainee plan lifecycle', () => {
  let api;
  let planId;
  let plan;
  beforeAll(async () => { api = await onboardedClient(app, { email: `life${DOMAIN}`, overrides: { limitations: ['shoulder'] } }); });

  test('generate from the profile, saved as the active plan', async () => {
    const res = await api.post('/api/plans/workout', { weeks: 8 });
    expect(res.status).toBe(201);
    ({ planId, plan } = res.body);
    expect(plan.summary).toMatchObject({ split: 'Upper / lower', weeks: 8, emphasis: 'hypertrophy' });
    expect(plan.summary.rpeCap).toBeNull(); // health shared, nothing flagged
    const names = Object.values(plan.sessions).flatMap(s => s.exercises.map(e => e.name)).join(' ');
    expect(names).not.toMatch(/overhead|military|upright row/i); // shoulder limitation
    expect(Object.values(plan.sessions).flatMap(s => s.exercises).every(e => e.pattern !== 'push-v')).toBe(true);
    const active = await api.get('/api/plans/workout/active');
    expect(active.body.planId).toBe(planId);
    expect(active.body.currentWeek).toBe(1);
    const again = await api.post('/api/plans/workout', {});
    const [[{ n }]] = await db.query(
      "SELECT COUNT(*) n FROM user_plans p JOIN users u USING (user_id) WHERE u.email = ? AND p.kind = 'workout' AND p.is_active = 1", [`life${DOMAIN}`]
    );
    expect(n).toBe(1);
    ({ planId, plan } = again.body);
  });

  test('week views follow the periodisation', async () => {
    const w3 = await api.get(`/api/plans/workout/${planId}/week/3`);
    const w4 = await api.get(`/api/plans/workout/${planId}/week/4`);
    expect(w3.body.phase).toBe('intensification');
    expect(w4.body.deload).toBe(true);
  });

  test('swap only to a listed alternative', async () => {
    const [key, session] = Object.entries(plan.sessions)[0];
    const ex = session.exercises[0];
    const bad = await api.post(`/api/plans/workout/${planId}/swap`, { sessionKey: key, slot: ex.slot, exerciseId: 1 });
    expect(bad.status).toBe(400);
    const ok = await api.post(`/api/plans/workout/${planId}/swap`, { sessionKey: key, slot: ex.slot, exerciseId: ex.alternatives[0].exerciseId });
    expect(ok.status).toBe(200);
    expect(ok.body.session.exercises[0].exerciseId).toBe(ex.alternatives[0].exerciseId);
    plan.sessions[key] = ok.body.session;
  });

  test('log sets, read them back, and get next-week adjustments', async () => {
    const [, session] = Object.entries(plan.sessions)[0];
    const ex = session.exercises[0];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; // local date
    const sets = Array.from({ length: ex.sets + 1 }, () => ({ reps: ex.reps[1], load_kg: 50, rpe: 6, done: true }));
    expect((await api.post(`/api/plans/workout/${planId}/logs`, { date: today, exerciseId: ex.exerciseId, sets })).status).toBe(201);
    // Re-logging the same day replaces, not duplicates.
    expect((await api.post(`/api/plans/workout/${planId}/logs`, { date: today, exerciseId: ex.exerciseId, sets })).status).toBe(201);
    const logs = await api.get(`/api/plans/workout/${planId}/logs?week=1`);
    expect(logs.body.logs).toHaveLength(sets.length);
    const adapt = await api.get(`/api/plans/workout/${planId}/adapt?week=1`);
    expect(adapt.body.adjustments.find(a => a.exerciseId === ex.exerciseId).change).toBe('progress');
    expect(adapt.body.adherence).toBe(0.25);
    expect((await api.post(`/api/plans/workout/${planId}/logs`, { date: today, exerciseId: 1, sets })).status).toBe(400);
  });

  test('plans are private to their owner', async () => {
    const other = await onboardedClient(app, { email: `other${DOMAIN}` });
    expect((await other.get(`/api/plans/workout/${planId}/week/1`)).status).toBe(404);
  });
});

test('declining health consent gives a cautious plan; a flagged screen caps effort at 6', async () => {
  const noHealth = await onboardedClient(app, { email: `nohealth${DOMAIN}`, consents: { health: false } });
  const a = (await noHealth.post('/api/plans/workout', {})).body.plan;
  expect(a.summary.rpeCap).toBe(7);
  const flagged = await onboardedClient(app, { email: `flag${DOMAIN}`, overrides: { parq: { chest_pain: true } } });
  const b = (await flagged.post('/api/plans/workout', {})).body.plan;
  expect(b.summary.rpeCap).toBe(6);
  expect(Object.values(b.sessions).some(s => s.finisher)).toBe(false);
});

test('trainers cannot generate trainee plans; visitors must log in', async () => {
  const trainer = await onboardedClient(app, { email: `coach${DOMAIN}`, role: 'trainer' });
  expect((await trainer.post('/api/plans/workout', {})).status).toBe(403);
  expect((await client(app).post('/api/plans/workout', {})).status).toBe(401);
});
