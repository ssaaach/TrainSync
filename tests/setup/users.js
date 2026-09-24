// Test accounts for browser suites (created in the disposable test DB).
const PASSWORD = 'playwright-pass-1';

const accountFor = role => ({ email: `pw-${role}@playwright.trainsync.test`, name: `PW ${role}`, role });

// Registers (if needed) and logs in within the page's browser context.
async function loginAs(page, role = 'trainee') {
  const { email, name } = accountFor(role);
  await page.request.post('/api/auth/register', {
    data: { email, name, role, password: PASSWORD, confirmPassword: PASSWORD },
  }); // 400 "already registered" on later runs is fine
  const res = await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
}

module.exports = { loginAs, accountFor, PASSWORD };
