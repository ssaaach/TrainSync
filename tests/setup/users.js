// Test accounts for browser suites (created in the disposable test DB).
const PASSWORD = 'playwright-pass-1';

const accountFor = role => ({ email: `pw-${role}@playwright.trainsync.test`, name: `PW ${role}`, role });

// POSTs JSON through the page's browser context (shares its cookies) with a
// CSRF token, the same way public/js/common.js does.
async function apiPost(page, url, data) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  return page.request.post(url, { data, headers: { 'x-csrf-token': csrfToken } });
}

// Registers (if needed) and logs in within the page's browser context.
async function loginAs(page, role = 'trainee') {
  const { email, name } = accountFor(role);
  await apiPost(page, '/api/auth/register', { email, name, role, password: PASSWORD, confirmPassword: PASSWORD });
  // (400 "already registered" on later runs is fine)
  const res = await apiPost(page, '/api/auth/login', { email, password: PASSWORD });
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
}

module.exports = { loginAs, accountFor, apiPost, PASSWORD };
