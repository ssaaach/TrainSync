// v3 Phase D: workout plans through the UI.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { stablePage } = require('../setup/pageMocks');
const { apiPost, completeOnboarding } = require('../setup/users');

test('visitor builds a preview plan and browses days', async ({ page }) => {
  await stablePage(page);
  await page.goto('/workoutplans.html');
  await page.click('.o-option:has-text("Lean bulk")');
  await page.click('button:has-text("Build my plan")');
  await expect(page.locator('[data-p-title]')).toContainText('weeks');
  await expect(page.locator('.p-ex').first()).toBeVisible();
  await expect(page.locator('.o-note--gold')).toContainText('shared health');
  await page.locator('.p-day:has-text("Wed")').click();
  await expect(page.locator('#p-session-title')).toHaveText('Full body B');
  await page.locator('.p-ex__row').first().click();
  await expect(page.locator('.p-ex[data-open] .p-why')).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['color-contrast']).analyze();
  expect(axe.violations.map(v => v.id)).toEqual([]);
});

test('trainee generates, swaps and logs', async ({ page }) => {
  await stablePage(page);
  const email = `wp-${Date.now()}@playwright.trainsync.test`;
  await apiPost(page, '/api/auth/register', { email, name: 'WP', role: 'trainee', password: 'wp-pass-123', confirmPassword: 'wp-pass-123' });
  await completeOnboarding(page, 'trainee');
  await page.goto('/workoutplans.html');
  await page.click('button:has-text("Build my plan")');
  await expect(page.locator('.p-ex').first()).toBeVisible();
  // First exercise that offers safe alternatives.
  const first = page.locator('.p-ex:has(.p-alts button)').first();
  await first.locator('.p-ex__row').click();
  const exId = await first.getAttribute('data-exercise');
  const oldName = await first.locator('.p-ex__name').innerText();
  await first.locator('.p-alts button').first().click();
  await expect(page.locator('.ts-toast', { hasText: 'Swapped in' })).toBeVisible();
  await expect(page.locator(`.p-ex[data-exercise="${exId}"]`)).toHaveCount(0);
  expect(oldName).toBeTruthy();
  const opened = page.locator('.p-ex[data-open]');
  await opened.locator('input[aria-label="Set 1 reps"]').fill('10');
  await opened.locator('input[aria-label="Set 1 done"]').check();
  await opened.locator('button:has-text("Save sets")').click();
  await expect(page.locator('.ts-toast', { hasText: 'Sets saved' })).toBeVisible();
  await expect(page.locator('[data-p-adapt]')).toBeVisible();
});
