// v3 Phase C: consent-first onboarding, purpose gating, erasure on withdrawal,
// export and account deletion.
const app = require('../../app');
const db = require('../../config/db');
const { store } = require('../../config/session');
const { client, resetRateLimits } = require('../setup/client');

const DOMAIN = '@consent.trainsync.test';
const PASSWORD = 'consent-pass-1';

async function cleanup() {
  await resetRateLimits(db);
  const [rows] = await db.query('SELECT user_id FROM users WHERE email LIKE ?', [`%${DOMAIN}`]);
  if (rows.length) await db.query('DELETE FROM consent_ledger WHERE user_id IN (?)', [rows.map(r => r.user_id)]);
  await db.query('DELETE FROM users WHERE email LIKE ?', [`%${DOMAIN}`]);
  await db.query("DELETE FROM gyms WHERE name = 'CONSENT gym'");
}

async function signup(role, local) {
  const api = client(app);
  const res = await api.post('/api/auth/register', {
    email: `${local}${DOMAIN}`, name: `${role} ${local}`, role, password: PASSWORD, confirmPassword: PASSWORD,
  });
  expect(res.status).toBe(201);
  expect(res.body.next).toBe('/onboarding.html');
  const [[u]] = await db.query('SELECT user_id FROM users WHERE email = ?', [`${local}${DOMAIN}`]);
  return { api, userId: u.user_id };
}

const ALL = { body_metrics: true, health: true, personality: true, interests: true, location: true, matching: true };
const BASICS = { sex: 'female', gender: 'female', age: 29, city: 'bengaluru', locality: 'Indiranagar', activity_level: 'light' };
const BODY = { height_cm: 162, weight_kg: 68, waist_cm: 84, neck_cm: 33, hip_cm: 102 };
const GOALS = {
  goal: 'cut', goals: ['fat-loss', 'general-fitness'], experience_level: 'beginner', days_per_week: 4, session_minutes: 45,
  equipment: ['body only', 'dumbbell'], diet_pref: 'veg', allergens: ['peanuts'], cuisines: ['south-indian'], food_budget_inr_per_day: 300,
};
const LOGISTICS = {
  modality: ['in_person_gym', 'online'], schedule: { mon: ['morning'], wed: ['morning', 'evening'] },
  languages: ['English', 'Kannada'], budget_per_session_inr: 1200, search_radius_km: 8,
};

beforeAll(async () => {
  await cleanup();
  await db.query("INSERT INTO localities (city, name, lat, lng, source) VALUES ('Bengaluru', 'Indiranagar', 12.9784, 77.6408, 'test') ON DUPLICATE KEY UPDATE lat = lat");
});
afterAll(async () => {
  await cleanup();
  await store.close();
  await db.end();
});

describe('trainee onboarding', () => {
  let api;
  let userId;
  beforeAll(async () => ({ api, userId } = await signup('trainee', 'tee')));

  test('registration signs the user in, not yet onboarded', async () => {
    const s = await api.get('/api/auth/session');
    expect(s.body).toMatchObject({ loggedIn: true, role: 'trainee', onboardingComplete: false });
    const o = await api.get('/api/onboarding');
    expect(o.body.consentDecided).toBe(false);
    expect(o.body.steps.map(x => x.id)).toEqual(['consent', 'basics', 'body', 'goals', 'health', 'personality', 'interests', 'coaching', 'logistics']);
    expect(Object.values(o.body.consents).every(v => v === false)).toBe(true);
    expect(o.body.options.miniIpip.items).toHaveLength(20);
  });

  test('the first consent decision records every purpose once', async () => {
    const res = await api.put('/api/onboarding/consent', { purposes: { ...ALL, personality: false, interests: false } });
    expect(res.status).toBe(200);
    expect(res.body.consents).toMatchObject({ body_metrics: true, personality: false });
    const [rows] = await db.query('SELECT purpose, granted, source, policy_version FROM consent_ledger WHERE user_id = ?', [userId]);
    expect(rows).toHaveLength(6);
    expect(rows.every(r => r.source === 'onboarding' && r.policy_version === '2026-09-24')).toBe(true);
  });

  test('basics: adults only; locality + coordinates saved with location consent', async () => {
    const young = await api.patch('/api/onboarding/steps/basics', { ...BASICS, age: 16 });
    expect(young.status).toBe(400);
    expect(young.body.error).toMatch(/at least 18/);
    const ok = await api.patch('/api/onboarding/steps/basics', BASICS);
    expect(ok.status).toBe(200);
    expect(ok.body.next).toBe('body');
    const [[t]] = await db.query('SELECT city, locality, lat, lng, sex, age FROM trainees WHERE user_id = ?', [userId]);
    expect(t).toMatchObject({ city: 'Bengaluru', locality: 'Indiranagar', lat: 12.9784, lng: 77.6408, sex: 'female', age: 29 });
  });

  test('body: validates the formula inputs and appends an assessment', async () => {
    const noHip = await api.patch('/api/onboarding/steps/body', { ...BODY, hip_cm: undefined });
    expect(noHip.status).toBe(400);
    const bad = await api.patch('/api/onboarding/steps/body', { ...BODY, height_cm: 260 });
    expect(bad.status).toBe(400);
    const ok = await api.patch('/api/onboarding/steps/body', BODY);
    expect(ok.status).toBe(200);
    expect(ok.body.assessment).toMatchObject({ method: 'hc-approx-v1', isEstimate: true });
    expect(ok.body.assessment.bodyFatPct).toBeGreaterThan(20);
    const [[t]] = await db.query('SELECT body_type FROM trainees WHERE user_id = ?', [userId]);
    expect(t.body_type).toBe(ok.body.assessment.dominantType);
    const [a] = await db.query('SELECT COUNT(*) n FROM body_assessments WHERE user_id = ?', [userId]);
    expect(a[0].n).toBe(1);
  });

  test('steps without consent are refused', async () => {
    const res = await api.patch('/api/onboarding/steps/personality', { answers: Array(20).fill(3) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('consent_required');
  });

  test('health screen flags a yes answer and stores limitations', async () => {
    const parq = { heart: false, chest_pain: false, dizziness: false, chronic: false, medication: false, bone_joint: true, supervised: false };
    const res = await api.patch('/api/onboarding/steps/health', { parq, limitations: ['knee'] });
    expect(res.body.flagged).toBe(true);
    const [[t]] = await db.query('SELECT health_flagged, limitations FROM trainees WHERE user_id = ?', [userId]);
    expect(t.health_flagged).toBe(1);
    expect(t.limitations).toEqual(['knee']);
  });

  test('cannot complete before the required steps', async () => {
    const res = await api.post('/api/onboarding/complete');
    expect(res.status).toBe(400);
    expect(res.body.missing).toEqual(['goals', 'logistics']);
  });

  test('goals + logistics, then complete', async () => {
    expect((await api.patch('/api/onboarding/steps/goals', GOALS)).status).toBe(200);
    expect((await api.patch('/api/onboarding/steps/coaching', { style: { structure: 4, tone: 2, checkin: 4, data: 3 } })).status).toBe(200);
    const bad = await api.patch('/api/onboarding/steps/logistics', { ...LOGISTICS, schedule: { funday: ['morning'] } });
    expect(bad.status).toBe(400);
    expect((await api.patch('/api/onboarding/steps/logistics', LOGISTICS)).status).toBe(200);
    const done = await api.post('/api/onboarding/complete');
    expect(done.body).toEqual({ complete: true, next: '/homepage1.html' });
    expect((await api.get('/api/auth/session')).body.onboardingComplete).toBe(true);
    const [[t]] = await db.query('SELECT goals, equipment, allergens, schedule, style_pref FROM trainees WHERE user_id = ?', [userId]);
    expect(t).toMatchObject({ goals: GOALS.goals, allergens: ['peanuts'], schedule: LOGISTICS.schedule, style_pref: { structure: 4, tone: 2, checkin: 4, data: 3 } });
  });

  test('withdrawing body-metrics consent erases measurements and assessments', async () => {
    const res = await api.put('/api/me/consent', { purposes: { body_metrics: false } });
    expect(res.body.erased).toEqual(['body_metrics']);
    const [[t]] = await db.query('SELECT height_cm, weight_kg, waist_cm, body_type, goal FROM trainees WHERE user_id = ?', [userId]);
    expect(t).toMatchObject({ height_cm: null, weight_kg: null, waist_cm: null, body_type: null, goal: 'cut' });
    const [[a]] = await db.query('SELECT COUNT(*) n FROM body_assessments WHERE user_id = ?', [userId]);
    expect(a.n).toBe(0);
    const [ledger] = await db.query("SELECT granted FROM consent_ledger WHERE user_id = ? AND purpose = 'body_metrics' ORDER BY ledger_id", [userId]);
    expect(ledger.map(r => r.granted)).toEqual([1, 0]);
    expect((await api.patch('/api/onboarding/steps/body', BODY)).status).toBe(403);
    expect((await api.post('/api/onboarding/body-preview', { ...BODY, sex: 'female', age: 29 })).status).toBe(403);
  });

  test('withdrawing location consent erases coordinates and locality (city stays)', async () => {
    await api.put('/api/me/consent', { purposes: { location: false } });
    const [[t]] = await db.query('SELECT city, locality, lat, lng FROM trainees WHERE user_id = ?', [userId]);
    expect(t).toEqual({ city: 'Bengaluru', locality: null, lat: null, lng: null });
  });

  test('unchanged consent writes no ledger rows', async () => {
    const [[before]] = await db.query('SELECT COUNT(*) n FROM consent_ledger WHERE user_id = ?', [userId]);
    await api.put('/api/me/consent', { purposes: { matching: true } });
    const [[after]] = await db.query('SELECT COUNT(*) n FROM consent_ledger WHERE user_id = ?', [userId]);
    expect(after.n).toBe(before.n);
  });

  test('GET /api/me/consent lists every purpose with its state', async () => {
    const res = await api.get('/api/me/consent');
    expect(res.body.purposes.map(p => p.purpose)).toEqual(['body_metrics', 'health', 'personality', 'interests', 'location', 'matching']);
    expect(res.body.purposes.find(p => p.purpose === 'location').granted).toBe(false);
  });

  test('export returns everything as a JSON download, without the password hash', async () => {
    const res = await api.get('/api/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="trainsync-export-\d{4}-\d{2}-\d{2}\.json"/);
    const data = JSON.parse(res.text);
    expect(data.account.email).toBe(`tee${DOMAIN}`);
    expect(JSON.stringify(data)).not.toMatch(/\$2[aby]\$/);
    expect(data.profile.goals).toEqual(GOALS.goals);
    expect(data.health_screens).toHaveLength(1);
    expect(data.consent_ledger.length).toBeGreaterThanOrEqual(8);
  });

  test('delete needs the password and the typed confirmation', async () => {
    expect((await api.delete('/api/me', { password: PASSWORD, confirm: 'delete' })).status).toBe(400);
    expect((await api.delete('/api/me', { password: 'wrong-one', confirm: 'DELETE' })).status).toBe(400);
    const res = await api.delete('/api/me', { password: PASSWORD, confirm: 'DELETE' });
    expect(res.body).toEqual({ deleted: true });
    const [[u]] = await db.query('SELECT COUNT(*) n FROM users WHERE user_id = ?', [userId]);
    expect(u.n).toBe(0);
    for (const t of ['trainees', 'health_screens', 'body_assessments']) {
      const [[r]] = await db.query(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`, [userId]);
      expect(r.n).toBe(0);
    }
    const [ledger] = await db.query("SELECT purpose FROM consent_ledger WHERE user_id = ? AND source = 'deletion'", [userId]);
    expect(ledger).toHaveLength(6);
    expect((await api.get('/api/auth/session')).body.loggedIn).toBe(false);
  });
});

describe('trainer onboarding', () => {
  let api;
  let userId;
  let gymId;
  beforeAll(async () => {
    ({ api, userId } = await signup('trainer', 'tor'));
    const [r] = await db.query("INSERT INTO gyms (name, city, lat, lng, source) VALUES ('CONSENT gym', 'Bengaluru', 12.97, 77.64, 'manual')");
    gymId = r.insertId;
  });

  test('trainer steps, gym validation and completion', async () => {
    const o = await api.get('/api/onboarding');
    expect(o.body.steps.map(x => x.id)).toEqual(['consent', 'basics', 'professional', 'coaching', 'personality', 'interests', 'logistics']);
    await api.put('/api/onboarding/consent', { purposes: { ...ALL, location: false } });
    expect((await api.patch('/api/onboarding/steps/basics', { gender: 'male', city: 'mumbai', locality: 'Bandra' })).status).toBe(200);
    const [[t1]] = await db.query('SELECT city, locality, lat FROM trainers WHERE user_id = ?', [userId]);
    expect(t1).toEqual({ city: 'Mumbai', locality: null, lat: null }); // no location consent
    const pro = {
      years_experience: 6, certifications: ['ACE-CPT'], specializations: ['strength', 'fat-loss'], best_level: 'intermediate',
      price_per_session_inr: 1500, max_clients: 12, bio: 'Strength coach.', home_gym_id: 999999999,
    };
    expect((await api.patch('/api/onboarding/steps/professional', pro)).status).toBe(400);
    expect((await api.patch('/api/onboarding/steps/professional', { ...pro, home_gym_id: gymId })).status).toBe(200);
    const pers = await api.patch('/api/onboarding/steps/personality', { answers: Array(20).fill(4) });
    expect(pers.body.big5).toEqual({ O: 0.375, C: 0.5, E: 0.5, A: 0.5, N: 0.5 });
    expect((await api.patch('/api/onboarding/steps/interests', { hobbies: 'Cricket and cooking', interests: ['cricket', 'cooking'] })).status).toBe(200);
    expect((await api.patch('/api/onboarding/steps/logistics', { modality: ['online'], schedule: { sat: ['morning'] }, languages: ['Hindi'], travel_radius_km: 5 })).status).toBe(200);
    expect((await api.post('/api/onboarding/complete')).status).toBe(200);
    const [[t]] = await db.query('SELECT specializations, experience, certification, home_gym_id, big5 FROM trainers WHERE user_id = ?', [userId]);
    expect(t).toMatchObject({ specializations: ['strength', 'fat-loss'], experience: 6, certification: 'ACE-CPT', home_gym_id: gymId });
  });

  test('trainee-only steps are unknown for trainers', async () => {
    expect((await api.patch('/api/onboarding/steps/body', BODY)).status).toBe(400);
  });
});

test('GET /api/localities lists a city\'s neighbourhoods', async () => {
  const res = await client(app).get('/api/localities?city=bengaluru');
  expect(res.status).toBe(200);
  expect(res.body.some(l => l.name === 'Indiranagar')).toBe(true);
  expect((await client(app).get('/api/localities?city=atlantis')).status).toBe(400);
});

test('onboarding and data-rights APIs require login', async () => {
  const api = client(app);
  expect((await api.get('/api/onboarding')).status).toBe(401);
  expect((await api.get('/api/me/export')).status).toBe(401);
});
