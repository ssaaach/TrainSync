// The full product journey: sign-up → consent → plans → match → session
// request → trainer accepts → both see contact details.
const { test, expect } = require('@playwright/test');
const { apiPost, completeOnboarding } = require('../setup/users');
const { stablePage } = require('../setup/pageMocks');

const PASSWORD = 'journey-pass-1';

test('trainee finds a trainer, requests a session, trainer accepts', async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const coach = `Jaya${stamp}`; // single word: shown in full, unique per run
  // Trainer signs up first (in Bengaluru, same schedule/language as the trainee).
  const trainerCtx = await browser.newContext();
  const tp = await trainerCtx.newPage();
  await apiPost(tp, '/api/auth/register', { email: `j-coach-${stamp}@playwright.trainsync.test`, name: coach, role: 'trainer', password: PASSWORD, confirmPassword: PASSWORD });
  await completeOnboarding(tp, 'trainer');

  // Trainee: register through the UI, consent, onboard, build plans.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await stablePage(page);
  await page.goto('/registration.html');
  await page.fill('#name', 'Journey Trainee');
  await page.fill('#email', `j-tee-${stamp}@playwright.trainsync.test`);
  await page.fill('#password', PASSWORD);
  await page.fill('#confirmPassword', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding.html**');
  await completeOnboarding(page, 'trainee');

  await page.goto('/workoutplans.html');
  await page.click('button:has-text("Build my plan")');
  await expect(page.locator('.p-ex').first()).toBeVisible();

  await page.goto('/dietplans.html');
  await page.click('button:has-text("Build my meal plan")');
  await expect(page.locator('.d-ring')).toBeVisible({ timeout: 60_000 });

  // Match: find the trainer, open the sheet, request a session.
  await page.goto('/trainermatch.html');
  await page.fill('[data-m-q]', coach);
  const card = page.locator('.m-card', { hasText: coach });
  await expect(card).toBeVisible();
  await card.locator('.m-card__open').click();
  await expect(page.locator('.m-summary')).toContainText(coach);
  await expect(page.locator('.m-why .ts-meter').first()).toBeVisible();
  await page.click('button:has-text("Request session")');
  await expect(page.locator('.ts-toast', { hasText: 'Request sent' })).toBeVisible();

  // Trainer accepts from their requests page.
  await tp.goto('/trainermatch.html');
  await expect(tp.locator('.m-req', { hasText: 'Journey T.' })).toBeVisible();
  await tp.locator('.m-req', { hasText: 'Journey T.' }).locator('button:has-text("Accept")').click();
  await expect(tp.locator('.m-req', { hasText: 'Journey Trainee' })).toContainText('@playwright.trainsync.test');

  // Trainee sees the contact details and a notification on the dashboard.
  await page.goto('/homepage1.html');
  await expect(page.locator('#matches')).toContainText(`j-coach-${stamp}@playwright.trainsync.test`);
  await expect(page.locator('#notifications')).toContainText('accepted your request');
  await trainerCtx.close();
  await ctx.close();
});
