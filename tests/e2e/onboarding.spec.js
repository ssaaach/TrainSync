// v3 Phase C: sign-up → consent → onboarding → dashboard, through the real UI,
// plus the privacy-center endpoints the dashboard uses.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { stablePage } = require('../setup/pageMocks');
const { apiPost } = require('../setup/users');

const PASSWORD = 'onboard-pass-1';
const stamp = Date.now();

// Validation 4xx responses are part of these flows; anything else is a bug.
function trackErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

async function registerViaUi(page, role, email) {
  await page.goto('/registration.html');
  await page.click(`label[for=role-${role}]`);
  await page.fill('#name', `Onb ${role}`);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.fill('#confirmPassword', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding.html**');
}

const next = page => page.click('[data-o-next]');
const title = page => page.locator('[data-o-title]');

async function axe(page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).disableRules(['color-contrast']).analyze();
  return r.violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')})`);
}

test('trainee: register → consent → every step → dashboard', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await stablePage(page);
  await registerViaUi(page, 'trainee', `onb-tee-${stamp}@playwright.trainsync.test`);

  // Consent step: nothing pre-ticked; "Allow all" ticks everything.
  await expect(title(page)).toHaveText('Your data, your choice');
  await expect(page.locator('.o-purpose input:checked')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
  await page.click('text=Allow all');
  await expect(page.locator('.o-purpose input:checked')).toHaveCount(6);
  await next(page);

  await expect(title(page)).toHaveText('About you');
  await page.click('label:has-text("Female")');
  await page.fill('input[name=age]', '17');
  await page.selectOption('select[name=city]', 'bengaluru');
  await page.click('.o-option:has-text("Lightly active")');
  await next(page);
  await expect(page.locator('#errorMessage')).toContainText('at least 18');
  await page.fill('input[name=age]', '29');
  await page.fill('input[name=locality]', 'Indiranagar');
  expect(await axe(page)).toEqual([]);
  await next(page);

  await expect(title(page)).toHaveText('Body measurements');
  for (const [n, v] of [['height_cm', 162], ['weight_kg', 68], ['waist_cm', 84], ['neck_cm', 33], ['hip_cm', 102]]) {
    await page.fill(`input[name=${n}]`, String(v));
  }
  await expect(page.locator('.o-preview')).toContainText('Body fat (est.)');
  await next(page);

  await expect(title(page)).toHaveText('Goals & training');
  await page.click('.o-option:has-text("Lose fat")');
  await page.click('.o-chip:has-text("Fat loss")');
  await page.click('label:has-text("Beginner")');
  await page.selectOption('select[name=diet_pref]', 'veg');
  await page.click('.o-chip:has-text("Peanuts")');
  expect(await axe(page)).toEqual([]);
  await next(page);

  await expect(title(page)).toHaveText('Health check');
  await page.locator('.o-yn').nth(5).locator('label:has-text("Yes")').click();
  await expect(page.locator('.o-note--gold')).toBeVisible();
  await page.click('.o-chip:has-text("Knee")');
  expect(await axe(page)).toEqual([]);
  await next(page);

  await expect(title(page)).toHaveText('Personality');
  for (let i = 0; i < 20; i++) {
    await expect(page.locator('.ts-hint').first()).toContainText(`Statement ${i + 1} of 20`);
    await page.locator('.o-likert__scale .o-option').nth((i % 5)).click();
  }

  await expect(title(page)).toHaveText('Interests');
  await page.click('.o-chip:has-text("Cricket")');
  await next(page);

  await expect(title(page)).toHaveText('Coaching style');
  await next(page);

  await expect(title(page)).toHaveText('Schedule & budget');
  await page.click('.o-chip:has-text("At a gym")');
  await page.click('[aria-label="Mon Morning"]');
  await page.click('[aria-label="Sat Morning"]');
  expect(await axe(page)).toEqual([]);
  await next(page);

  await expect(page.locator('.o-done')).toContainText('You’re all set');
  await next(page);
  await page.waitForURL('**/homepage1.html');

  const o = await (await page.request.get('/api/onboarding')).json();
  expect(o.complete).toBe(true);
  expect(o.profile).toMatchObject({ sex: 'female', age: 29, city: 'Bengaluru', locality: 'Indiranagar', goal: 'cut', diet_pref: 'veg', allergens: ['peanuts'], limitations: ['knee'], health_flagged: 1 });
  expect(o.profile.schedule).toEqual({ mon: ['morning'], sat: ['morning'] });
  expect(Object.keys(o.profile.big5).sort()).toEqual(['A', 'C', 'E', 'N', 'O']);
  expect(errors).toEqual([]);
});

test('trainer: declined purposes are skipped; resuming works', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await stablePage(page);
  await registerViaUi(page, 'trainer', `onb-tor-${stamp}@playwright.trainsync.test`);

  // Allow everything except personality and interests.
  await page.click('text=Allow all');
  await page.click('label[for=consent-personality]');
  await page.click('label[for=consent-interests]');
  await next(page);

  await expect(title(page)).toHaveText('About you');
  await page.selectOption('select[name=gender]', 'male');
  await page.selectOption('select[name=city]', 'mumbai');
  await next(page);

  await expect(title(page)).toHaveText('Your coaching');
  await page.fill('input[name=years_experience]', '7');
  await page.click('.o-chip:has-text("Strength")');
  await page.click('.o-chip:has-text("ACE-CPT")');
  await page.click('label:has-text("Intermediate")');
  await page.fill('input[name=price_per_session_inr]', '1500');
  await next(page);
  await expect(title(page)).toHaveText('Coaching style');

  // Leave and come back: resumes at the next unsaved step.
  await page.goto('/homepage.html');
  await page.goto('/onboarding.html');
  await expect(title(page)).toHaveText('Coaching style');
  await next(page);

  // Personality and interests were declined → straight to logistics.
  await expect(title(page)).toHaveText('Schedule & area');
  await page.click('.o-chip:has-text("Online")');
  await next(page);
  await expect(page.locator('.o-done')).toBeVisible();
  await next(page);
  await page.waitForURL('**/homepage1.html');
  expect(errors).toEqual([]);
});

test('an unfinished user is sent back to onboarding from login and the dashboard', async ({ page }) => {
  const email = `onb-half-${stamp}@playwright.trainsync.test`;
  await apiPost(page, '/api/auth/register', { email, name: 'Half', role: 'trainee', password: PASSWORD, confirmPassword: PASSWORD });
  await page.goto('/homepage1.html');
  await page.waitForURL('**/onboarding.html**');
  await apiPost(page, '/api/auth/logout', {});
  await page.goto('/login.html');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding.html**');
});

test('privacy center endpoints: export downloads and deletion signs out', async ({ page }) => {
  const email = `onb-del-${stamp}@playwright.trainsync.test`;
  await apiPost(page, '/api/auth/register', { email, name: 'Del', role: 'trainee', password: PASSWORD, confirmPassword: PASSWORD });
  const exp = await page.request.get('/api/me/export');
  expect(exp.headers()['content-disposition']).toMatch(/attachment/);
  expect((await exp.json()).account.email).toBe(email);
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const del = await page.request.delete('/api/me', { data: { password: PASSWORD, confirm: 'DELETE' }, headers: { 'x-csrf-token': csrfToken } });
  expect(await del.json()).toEqual({ deleted: true });
  expect((await (await page.request.get('/api/auth/session')).json()).loggedIn).toBe(false);
});
