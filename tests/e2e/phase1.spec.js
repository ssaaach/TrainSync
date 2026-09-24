// Phase 1 browser flows: the real pages driving the real API.
const { test, expect } = require('@playwright/test');
const { apiPost, completeOnboarding } = require('../setup/users');

const PASSWORD = 'e2e-password-1';
const stamp = Date.now();

// Fail on any console error (CSP violations, script exceptions, 5xx fetches).
function trackErrors(page) {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

for (const role of ['trainee', 'trainer']) {
  test(`${role}: register → login → dashboard → update profile → logout via the UI`, async ({ page }) => {
    const errors = trackErrors(page);
    const email = `e2e-${role}-${stamp}@playwright.trainsync.test`;

    await page.goto('/registration.html');
    await page.fill('#email', email);
    await page.fill('#name', `E2E ${role}`);
    await page.click(`label[for=role-${role}]`);
    await page.fill('#password', PASSWORD);
    await page.fill('#confirmPassword', PASSWORD);
    await page.click('button[type=submit]');
    // Registration signs you in and starts onboarding (covered in
    // onboarding.spec.js); finish it through the API, then log in again.
    await page.waitForURL('**/onboarding.html**');
    await completeOnboarding(page, role);
    await apiPost(page, '/api/auth/logout', {});
    await page.goto('/login.html');

    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL('**/homepage1.html');
    await expect(page.locator('.overlay-text')).toContainText('Sore Today');

    // The menu starts open; ☰ toggles it.
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();
    await page.click('#user-menu-toggle');
    await expect(sidebar).toBeHidden();
    await page.click('#user-menu-toggle');
    await expect(sidebar).toBeVisible();

    await page.click('text=Update Profile');
    await page.waitForURL('**/updateprofile.html');
    await expect(page.locator('#name')).toHaveValue(`E2E ${role}`);
    await expect(page.locator(`[data-role="${role}"]`)).toBeVisible();
    await expect(page.locator(`[data-role="${role === 'trainer' ? 'trainee' : 'trainer'}"]`)).toBeHidden();

    if (role === 'trainee') {
      await page.fill('#age', '31');
      await page.fill('#gender', 'Male');
      await page.fill('#fitness_goal', 'run a 10k');
    } else {
      await page.fill('#experience', '8');
      await page.fill('#certification', 'NSCA-CPT');
      await page.fill('#specialization', 'endurance');
    }
    await page.fill('#location', 'Jayanagar');
    await page.click('button[type=submit]');
    await expect(page.locator('#errorMessage')).toHaveText('Profile saved.');

    await page.reload();
    await expect(page.locator('#location')).toHaveValue('Jayanagar');
    if (role === 'trainee') await expect(page.locator('#gender')).toHaveValue('male');

    await page.goto('/homepage1.html');
    await page.click('#logout-btn');
    await page.waitForURL('**/homepage.html');
    await expect(page.locator('.ts-nav').getByRole('link', { name: 'Log in' })).toBeVisible();

    // Logged out: the dashboard bounces to login.
    await page.goto('/homepage1.html');
    await page.waitForURL('**/login.html');

    expect(errors).toEqual([]);
  });
}

test('homepage shows the user menu when logged in, and logout works', async ({ page }) => {
  const errors = trackErrors(page);
  const email = `e2e-home-${stamp}@playwright.trainsync.test`;
  await apiPost(page, '/api/auth/register', { email, name: 'Home', role: 'trainee', password: PASSWORD, confirmPassword: PASSWORD });
  await page.goto('/homepage.html');
  const menuButton = page.locator('[data-ts-usermenu]');
  await expect(menuButton).toContainText('Home');
  await menuButton.click();
  await expect(page.locator('.ts-usermenu__panel')).toContainText(email);
  await page.locator('.ts-usermenu__panel [data-ts-logout]').click();
  await page.waitForURL('**/homepage.html');
  await expect(page.locator('.ts-nav').getByRole('link', { name: 'Log in' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('login shows the server error message for bad credentials', async ({ page }) => {
  await page.goto('/login.html');
  await page.fill('#email', 'nobody@playwright.trainsync.test');
  await page.fill('#password', 'whatever');
  await page.click('button[type=submit]');
  await expect(page.locator('#errorMessage')).toHaveText('Invalid email or password');
});

test('every page loads without console or CSP errors', async ({ page }) => {
  const errors = trackErrors(page);
  for (const p of ['homepage', 'login', 'registration', 'privacy', 'trainermatch', 'workoutplans', 'dietplans', 'gyms']) {
    await page.goto(`/${p}.html`);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  }
  expect(errors).toEqual([]);
});

test('trainer carousel buttons still work without inline handlers', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto('/trainermatch.html');
  await page.click('#reject');
  await expect(page.locator('#trainer-name')).toHaveText('Trainer 2');
  await page.click('#match');
  expect(dialogs).toContain('You have matched with Trainer 2!');
  await expect(page.locator('#trainer-name')).toHaveText('Trainer 3');
});

test('gym search reports a city with no gyms', async ({ page }) => {
  await page.goto('/gyms.html');
  await page.fill('#city', 'nowhere-city');
  await page.click('button');
  await expect(page.locator('#gymResults')).toHaveText('No gyms found in this city.');
});

