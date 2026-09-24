// Core account flows and page health through the real UI.
const { test, expect } = require('@playwright/test');
const { apiPost, completeOnboarding } = require('../setup/users');
const { stablePage } = require('../setup/pageMocks');

const PASSWORD = 'e2e-password-1';
const stamp = Date.now();

function trackErrors(page) {
  const errors = [];
  // 4xx = expected validation responses; ERR_FAILED = map tiles the mocks abort.
  page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

for (const role of ['trainee', 'trainer']) {
  test(`${role}: register → onboard → log out → log in → dashboard`, async ({ page }) => {
    const errors = trackErrors(page);
    await stablePage(page);
    const email = `e2e-${role}-${stamp}@playwright.trainsync.test`;
    await page.goto('/registration.html');
    await page.click(`label[for=role-${role}]`);
    await page.fill('#name', `E2E ${role}`);
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.fill('#confirmPassword', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL('**/onboarding.html**');
    await completeOnboarding(page, role);
    await page.goto('/homepage1.html');
    await expect(page.locator('[data-db-hello]')).toContainText(`Hi E2E`);
    await expect(page.locator('#privacy')).toBeVisible();
    await page.locator('[data-ts-usermenu]').click();
    await page.locator('.ts-usermenu__panel [data-ts-logout]').click();
    await page.waitForURL('**/homepage.html');
    await page.goto('/login.html');
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL('**/homepage1.html');
    await page.goto('/homepage1.html');
    await expect(page.locator('#privacy')).toBeVisible();
    // Logged out: the dashboard bounces to login.
    await apiPost(page, '/api/auth/logout', {});
    await page.goto('/homepage1.html');
    await page.waitForURL('**/login.html');
    expect(errors).toEqual([]);
  });
}

test('login shows the server error message for bad credentials', async ({ page }) => {
  await page.goto('/login.html');
  await page.fill('#email', 'nobody@playwright.trainsync.test');
  await page.fill('#password', 'whatever');
  await page.click('button[type=submit]');
  await expect(page.locator('#errorMessage')).toHaveText('Invalid email or password');
});

test('every page loads without console or CSP errors', async ({ page }) => {
  const errors = trackErrors(page);
  await stablePage(page);
  for (const p of ['homepage', 'login', 'registration', 'privacy', 'trainermatch', 'workoutplans', 'dietplans', 'gyms']) {
    await page.goto(`/${p}.html`);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  }
  expect(errors).toEqual([]);
});

test('gym search by city lists gyms or reports none', async ({ page }) => {
  await stablePage(page);
  await page.goto('/gyms.html');
  await page.fill('#city', 'nowhere-city');
  await page.click('button[type=submit]');
  await expect(page.locator('.g-list')).toContainText('No gyms found');
});

test('old profile URL redirects to the profile editor', async ({ page }) => {
  await page.goto('/updateprofile.html');
  await page.waitForURL(/onboarding\.html|login\.html/);
});
