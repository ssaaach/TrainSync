// Matching: ranking API, privacy of cards, request state machine, block,
// and fallbacks (missing ranker artifact, meal solver failure).
const fs = require('fs');
const path = require('path');
const app = require('../../app');
const db = require('../../config/db');
const { store } = require('../../config/session');
const matching = require('../../services/matching');
const mp = require('../../services/mealPlanner');
const { client, resetRateLimits } = require('../setup/client');
const { onboardedClient } = require('../setup/onboard');

const DOMAIN = '@match.trainsync.test';
jest.setTimeout(120_000);
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

describe('match flow', () => {
  let tee;
  let coach;
  let coachId;
  let requestId;
  beforeAll(async () => {
    coach = await onboardedClient(app, { email: `coach${DOMAIN}`, role: 'trainer', overrides: { professional: { specializations: ['muscle-gain', 'strength'], best_level: 'intermediate', max_clients: 1 } } });
    tee = await onboardedClient(app, { email: `tee${DOMAIN}` });
    const [[u]] = await db.query('SELECT user_id FROM users WHERE email = ?', [`coach${DOMAIN}`]);
    coachId = u.user_id;
  });

  test('recommendations rank the fitting trainer with reasons, and never leak contact details', async () => {
    const res = await tee.get('/api/match/recommendations?limit=60');
    expect(res.status).toBe(200);
    const card = res.body.trainers.find(t => t.trainerId === coachId);
    expect(card).toBeDefined();
    expect(card.score).toBeGreaterThan(50);
    expect(card.reasons.length).toBeGreaterThan(0);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/@match\.trainsync\.test/);
    expect(card).not.toHaveProperty('lat');
    const d = await tee.get(`/api/match/trainers/${coachId}`);
    expect(d.body.breakdown.goals).toBe(100);
    expect(d.body).not.toHaveProperty('email');
  });

  test('shortlist add/remove', async () => {
    expect((await tee.put(`/api/match/shortlist/${coachId}`)).status).toBe(200);
    expect((await tee.get('/api/match/shortlist')).body.ids).toContain(coachId);
    await tee.delete(`/api/match/shortlist/${coachId}`);
    expect((await tee.get('/api/match/shortlist')).body.ids).not.toContain(coachId);
  });

  test('request → duplicate refused → trainer accepts → contacts unlock → capacity enforced', async () => {
    const r = await tee.post('/api/match/requests', { trainerId: coachId, session_type: 'in_person_gym', slot: 'mon:morning', message: 'Hi!' });
    expect(r.status).toBe(201);
    requestId = r.body.requestId;
    expect((await tee.post('/api/match/requests', { trainerId: coachId, session_type: 'in_person_gym', slot: 'mon:morning' })).status).toBe(409);
    expect((await tee.post('/api/match/requests', { trainerId: coachId, session_type: 'outdoor', slot: 'mon:morning' })).status).toBe(400);
    expect((await tee.get('/api/match/contacts')).body.contacts).toHaveLength(0);
    const inbox = await coach.get('/api/match/requests');
    expect(inbox.body.requests[0]).toMatchObject({ requestId, status: 'pending', name: 'Jest t.' });
    expect((await tee.post(`/api/match/requests/${requestId}/respond`, { action: 'accept' })).status).toBe(403);
    expect((await coach.post(`/api/match/requests/${requestId}/respond`, { action: 'accept' })).body.status).toBe('accepted');
    const contacts = (await tee.get('/api/match/contacts')).body.contacts;
    expect(contacts[0].email).toBe(`coach${DOMAIN}`);
    expect((await tee.get('/api/match/notifications')).body.unread).toBeGreaterThan(0);
    // max_clients = 1: the trainer is now full.
    const other = await onboardedClient(app, { email: `tee2${DOMAIN}` });
    expect((await other.post('/api/match/requests', { trainerId: coachId, session_type: 'in_person_gym', slot: 'mon:morning' })).status).toBe(409);
    // Trainee cancels an accepted session: capacity frees up.
    expect((await tee.post(`/api/match/requests/${requestId}/respond`, { action: 'cancel' })).body.status).toBe('cancelled');
    const [[t]] = await db.query('SELECT active_clients FROM trainers WHERE user_id = ?', [coachId]);
    expect(t.active_clients).toBe(0);
  });

  test('two simultaneous accepts resolve to exactly one acceptance', async () => {
    const r = await tee.post('/api/match/requests', { trainerId: coachId, session_type: 'in_person_gym', slot: 'tue:morning' });
    const results = await Promise.all([1, 2].map(() => coach.post(`/api/match/requests/${r.body.requestId}/respond`, { action: 'accept' })));
    expect(results.map(x => x.status).sort()).toEqual([200, 409]);
    const [[t]] = await db.query('SELECT active_clients FROM trainers WHERE user_id = ?', [coachId]);
    expect(t.active_clients).toBe(1);
  });

  test('blocking hides the trainer', async () => {
    await tee.post(`/api/match/block/${coachId}`);
    const res = await tee.get('/api/match/recommendations?limit=60');
    expect(res.body.trainers.some(t => t.trainerId === coachId)).toBe(false);
    expect((await tee.get(`/api/match/trainers/${coachId}`)).status).toBe(404);
  });

  test('without matching consent there are no recommendations', async () => {
    const api = await onboardedClient(app, { email: `nomatch${DOMAIN}`, consents: { matching: false } });
    expect((await api.get('/api/match/recommendations')).body.consentRequired).toBe(true);
  });
});

describe('fallbacks: the app never fails because a model is missing', () => {
  const artifact = path.join(__dirname, '..', '..', 'ml', 'artifacts', 'ranker.json');
  test('missing ranker artifact → rule weights', () => {
    const backup = fs.existsSync(artifact) ? fs.readFileSync(artifact) : null;
    try {
      if (backup) fs.renameSync(artifact, `${artifact}.bak`);
      expect(matching.loadModel().source).toBe('default');
    } finally {
      if (backup) fs.renameSync(`${artifact}.bak`, artifact);
      matching.loadModel();
    }
  });

  test('meal optimizer failure → greedy planner with the same output shape', async () => {
    const plan = await mp.planWeek({ diet_pref: 'veg' }, { kcal: 2000, protein_g: 100, carbs_g: 250, fat_g: 60 }, { engine: 'fallback' });
    expect(plan.engine).toBe('fallback');
    expect(plan.days).toHaveLength(7);
    expect(plan.days[0].meals.length).toBeGreaterThanOrEqual(4);
  });

  test('scorer is explainable and bounded', () => {
    const f = matching.factors(
      { goals: ['strength'], style_pref: { structure: 5, tone: 3, checkin: 3, data: 3 }, schedule: { mon: ['morning'] }, budget_per_session_inr: 1000, experience_level: 'beginner', modality: ['online'] },
      { specializations: ['strength'], coaching_style: { structure: 5, tone: 3, checkin: 3, data: 3 }, schedule: { mon: ['morning'] }, price_per_session_inr: 900, best_level: 'beginner', modality: ['online'], rating_count: 0 },
      {}
    );
    expect(f.goals).toBe(1);
    expect(f.distance).toBe(1); // both online
    const s = matching.score(f);
    expect(s).toBeGreaterThan(80);
    expect(s).toBeLessThanOrEqual(100);
  });
});

test('visitors cannot use matching', async () => {
  expect((await client(app).get('/api/match/recommendations')).status).toBe(401);
});
