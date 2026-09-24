// Jest helper: register + onboard a trainee/trainer through the API.
const { client } = require('./client');

const PARQ_NO = { heart: false, chest_pain: false, dizziness: false, chronic: false, medication: false, bone_joint: false, supervised: false };

async function onboardedClient(app, { email, role = 'trainee', password = 'plans-pass-1', consents = {}, overrides = {} }) {
  const api = client(app);
  const reg = await api.post('/api/auth/register', { email, name: `Jest ${role}`, role, password, confirmPassword: password });
  if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const all = { body_metrics: true, health: true, personality: true, interests: true, location: true, matching: true, ...consents };
  await api.put('/api/onboarding/consent', { purposes: all });
  const must = async (path, body) => {
    const r = await api.patch(`/api/onboarding/steps/${path}`, body);
    if (r.status !== 200) throw new Error(`${path} ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  };
  if (role === 'trainee') {
    await must('basics', { sex: 'male', age: 30, city: 'bengaluru', activity_level: 'moderate', ...overrides.basics });
    if (all.body_metrics) await must('body', { height_cm: 175, weight_kg: 78, waist_cm: 86, neck_cm: 38, ...overrides.body });
    await must('goals', {
      goal: 'lean-bulk', goals: ['muscle-gain'], experience_level: 'intermediate', days_per_week: 4, session_minutes: 60,
      equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bench'], diet_pref: 'veg', ...overrides.goals,
    });
    if (all.health) await must('health', { parq: { ...PARQ_NO, ...(overrides.parq || {}) }, limitations: overrides.limitations || [] });
    await must('logistics', {
      modality: ['in_person_gym'], schedule: { mon: ['morning'], tue: ['morning'], thu: ['morning'], fri: ['morning'] },
      languages: ['English'], budget_per_session_inr: 1000, search_radius_km: 8, ...overrides.logistics,
    });
  } else {
    await must('basics', { gender: 'female', city: 'bengaluru', ...overrides.basics });
    await must('professional', {
      years_experience: 5, certifications: ['ACE-CPT'], specializations: ['strength'], best_level: 'beginner',
      price_per_session_inr: 1000, max_clients: 10, ...overrides.professional,
    });
    await must('logistics', { modality: ['in_person_gym'], schedule: { mon: ['morning'] }, languages: ['English'], travel_radius_km: 5, ...overrides.logistics });
  }
  const done = await api.post('/api/onboarding/complete');
  if (done.status !== 200) throw new Error(`complete ${done.status}`);
  return api;
}

module.exports = { onboardedClient, PARQ_NO };
