// v3 Phase B: landing page behaviour, design-system pages and accessibility.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { stablePage, STATS } = require('../setup/pageMocks');

function trackErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

test('landing renders every section with live stats and no console/CSP errors', async ({ page }) => {
  const errors = trackErrors(page);
  await stablePage(page);
  await page.goto('/homepage.html');
  await expect(page.locator('h1')).toContainText('Stay fit');
  for (const id of ['#about', '#features', '#how', '#gyms-preview']) await expect(page.locator(id)).toBeVisible();
  // Stats come from /api/stats (rounded down, never inflated).
  await expect(page.locator('.l-stat [data-stat="gyms"]')).toHaveText('700+');
  await expect(page.locator('.l-stat [data-stat="cities"]')).toHaveText(String(STATS.cities));
  // Nav for visitors: Features · How it works · Gyms · Log in · Get started.
  const nav = page.locator('.ts-nav');
  await expect(nav.getByRole('link', { name: 'Features' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login.html');
  await expect(nav.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/registration.html');
  // Footer carries the data attributions.
  await expect(page.locator('footer')).toContainText('OpenStreetMap contributors');
  await expect(page.locator('footer')).toContainText('USDA FoodData Central');
  expect(errors).toEqual([]);
});

test('how-it-works carousel moves with the arrow buttons', async ({ page }) => {
  await stablePage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/homepage.html');
  const track = page.locator('#how-track');
  await track.scrollIntoViewIfNeeded();
  await expect(page.locator('[data-carousel-prev]')).toBeDisabled();
  await page.click('[data-carousel-next]');
  await expect.poll(() => track.evaluate(t => t.scrollLeft)).toBeGreaterThan(100);
  await expect(page.locator('[data-carousel-prev]')).toBeEnabled();
});

test('mobile menu opens, closes and contains the CTAs', async ({ page }) => {
  await stablePage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/homepage.html');
  const toggle = page.locator('[data-ts-menu-toggle]');
  await toggle.click();
  const menu = page.locator('#ts-menu');
  await expect(menu).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('link', { name: 'Get started' })).toBeVisible();
  await toggle.click();
  await expect(menu).toBeHidden();
});

test('reduced motion shows the poster instead of loading video', async ({ page }) => {
  await stablePage(page); // emulates prefers-reduced-motion: reduce
  const videoRequests = [];
  page.on('request', r => { if (/\.(mp4|webm)$/.test(r.url())) videoRequests.push(r.url()); });
  await page.goto('/homepage.html');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.ts-bg')).toHaveAttribute('data-mode', 'poster');
  expect(videoRequests).toEqual([]);
});

test('without reduced motion the smoke video plays behind every section', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, r => r.abort());
  await page.goto('/homepage.html');
  const bg = page.locator('.ts-bg');
  await expect(bg).toHaveAttribute('data-mode', 'video');
  await expect(bg.locator('video')).toHaveJSProperty('muted', true);
  expect(await bg.evaluate(el => getComputedStyle(el).position)).toBe('fixed');
});

test('gym finder mini map loads Leaflet lazily and plots nearby gyms', async ({ page }) => {
  await stablePage(page);
  await page.goto('/homepage.html');
  expect(await page.evaluate(() => typeof window.L)).toBe('undefined');
  await page.locator('#gyms-preview').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-minimap] .l-pin')).toHaveCount(6);
  await expect(page.locator('[data-minimap] .leaflet-control-attribution')).toContainText('OpenStreetMap');
});

test('login and registration use the shared form components', async ({ page }) => {
  await stablePage(page);
  await page.goto('/registration.html');
  await expect(page.locator('#role-trainee')).toBeChecked();
  await page.click('label[for=role-trainer]');
  await expect(page.locator('#role-trainer')).toBeChecked();
  await page.fill('#password', 'abc12345');
  await page.fill('#confirmPassword', 'different1');
  await page.fill('#name', 'X');
  await page.fill('#email', 'x@example.com');
  await page.click('button[type=submit]');
  await expect(page.locator('#errorMessage')).toHaveText('Passwords do not match');
  await expect(page.locator('#confirmPassword')).toHaveAttribute('aria-invalid', 'true');

  await page.goto('/login.html');
  await page.fill('#password', 'secret-pass');
  await page.click('[data-pw-toggle]');
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
});

test('login refuses off-site ?next= redirects', async ({ page }) => {
  await page.goto('/login.html?next=//evil.example/steal');
  const dest = await page.evaluate(() => {
    const next = new URLSearchParams(location.search).get('next');
    return next && /^\/(?!\/)[\w\-./#?=&]*$/.test(next) ? next : '/homepage1.html';
  });
  expect(dest).toBe('/homepage1.html');
});

for (const url of ['/homepage.html', '/login.html', '/registration.html', '/privacy.html']) {
  test(`axe: no WCAG 2.1 A/AA violations on ${url}`, async ({ page }) => {
    await stablePage(page);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      // Over the video, axe can't compute contrast (it reports "incomplete");
      // tests/e2e/contrast.spec.js measures it on the rendered pixels instead.
      .disableRules(['color-contrast'])
      .exclude('.leaflet-container')
      .analyze();
    expect(results.violations.map(v => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });
}
