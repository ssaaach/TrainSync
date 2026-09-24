// Visual-regression gate. Baselines live in tests/visual/baseline/ and are
// committed; regenerate intentionally with UPDATE_BASELINE=1.
//
//   V3_PAGES      pages rebuilt on the v3 design system, captured at five
//                 widths (360 → 1920) with deterministic data (pageMocks) and
//                 reduced motion (poster frame, no reveal animation).
//   LEGACY_PAGES  pages not rebuilt yet; they keep their v2 baselines until
//                 their phase replaces them.
const { test, expect } = require('@playwright/test');
const { freezeMedia, compareToBaseline, MAX_DIFF_RATIO } = require('./helpers');
const { loginAs } = require('../setup/users');
const { stablePage } = require('../setup/pageMocks');

const V3_VIEWPORTS = {
  360: { width: 360, height: 740 },
  390: { width: 390, height: 844 },
  768: { width: 768, height: 1024 },
  1440: { width: 1440, height: 900 },
  1920: { width: 1920, height: 1080 },
};
const V3_PAGES = [
  { name: 'homepage', path: '/homepage.html' },
  { name: 'login', path: '/login.html' },
  { name: 'registration', path: '/registration.html' },
  { name: 'privacy', path: '/privacy.html' },
];

const LEGACY_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const LEGACY_PAGES = [
  { name: 'homepage1', path: '/homepage1.html', setup: page => loginAs(page, 'trainee') },
  { name: 'trainermatch', path: '/trainermatch.html' },
  { name: 'workoutplans', path: '/workoutplans.html' },
  { name: 'dietplans', path: '/dietplans.html' },
  { name: 'gyms', path: '/gyms.html' },
];

async function capture(page, name, pageDef) {
  await page.goto(pageDef.path, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await freezeMedia(page);
  const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  const result = compareToBaseline(name, shot, pageDef.compare);
  if (result.written) return;
  expect(result.reason, result.reason).toBeUndefined();
  expect(result.ratio, `${(result.ratio * 100).toFixed(4)}% pixels differ`).toBeLessThanOrEqual(MAX_DIFF_RATIO);
}

for (const pageDef of V3_PAGES) {
  for (const [vpName, viewport] of Object.entries(V3_VIEWPORTS)) {
    test(`v3 ${pageDef.name} @ ${vpName}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await stablePage(page);
      if (pageDef.setup) await pageDef.setup(page);
      await capture(page, `v3-${pageDef.name}-${vpName}`, pageDef);
    });
  }
}

for (const pageDef of LEGACY_PAGES) {
  for (const [vpName, viewport] of Object.entries(LEGACY_VIEWPORTS)) {
    test(`${pageDef.name} @ ${vpName}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      if (pageDef.setup) await pageDef.setup(page);
      await capture(page, `${pageDef.name}-${vpName}`, pageDef);
    });
  }
}
