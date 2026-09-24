// Test accounts for browser suites (created in the disposable test DB).
const PASSWORD = 'playwright-pass-1';

const accountFor = role => ({ email: `pw-${role}@playwright.trainsync.test`, name: `PW ${role}`, role });

// POSTs JSON through the page's browser context (shares its cookies) with a
// CSRF token, the same way public/js/common.js does.
async function apiPost(page, url, data) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  return page.request.post(url, { data, headers: { 'x-csrf-token': csrfToken } });
}

async function api(page, method, url, data) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const res = await page.request.fetch(url, { method, data, headers: { 'x-csrf-token': csrfToken } });
  if (!res.ok()) throw new Error(`${method} ${url} -> ${res.status()} ${await res.text()}`);
  return res;
}

// Minimal, valid onboarding through the API for the logged-in page context.
async function completeOnboarding(page, role) {
  await api(page, 'PUT', '/api/onboarding/consent', { purposes: { body_metrics: true, health: true, personality: true, interests: true, location: true, matching: true } });
  const logistics = { modality: ['in_person_gym'], schedule: { mon: ['morning'] }, languages: ['English'] };
  if (role === 'trainer') {
    await api(page, 'PATCH', '/api/onboarding/steps/basics', { gender: 'female', city: 'bengaluru' });
    await api(page, 'PATCH', '/api/onboarding/steps/professional', {
      years_experience: 5, certifications: ['ACE-CPT'], specializations: ['strength'], best_level: 'beginner', price_per_session_inr: 1000, max_clients: 10,
    });
    await api(page, 'PATCH', '/api/onboarding/steps/logistics', { ...logistics, travel_radius_km: 5 });
  } else {
    await api(page, 'PATCH', '/api/onboarding/steps/basics', { sex: 'male', age: 30, city: 'bengaluru', activity_level: 'moderate' });
    await api(page, 'PATCH', '/api/onboarding/steps/goals', {
      goal: 'maintenance', goals: ['general-fitness'], experience_level: 'beginner', days_per_week: 3, session_minutes: 45,
      equipment: ['body only'], diet_pref: 'veg',
    });
    await api(page, 'PATCH', '/api/onboarding/steps/logistics', { ...logistics, budget_per_session_inr: 1000, search_radius_km: 8 });
  }
  await api(page, 'POST', '/api/onboarding/complete');
}

// Registers + onboards (first time) and logs in within the page's context.
async function loginAs(page, role = 'trainee') {
  const { email, name } = accountFor(role);
  const reg = await apiPost(page, '/api/auth/register', { email, name, role, password: PASSWORD, confirmPassword: PASSWORD });
  if (reg.ok()) await completeOnboarding(page, role); // 400 "already registered" on later runs is fine
  const res = await apiPost(page, '/api/auth/login', { email, password: PASSWORD });
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
}

module.exports = { loginAs, completeOnboarding, accountFor, apiPost, PASSWORD };
