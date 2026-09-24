// Visual-regression gate for every page that existed before TrainSync v2.
// Baselines live in tests/visual/baseline/ and are committed.
const { test, expect } = require('@playwright/test');
const { freezeMedia, compareToBaseline, MAX_DIFF_RATIO } = require('./helpers');

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// Per-page options: `setup(page)` runs before navigation (e.g. log in);
// `compare[viewport]` passes compareHeight/masks to the comparator.
const PAGES = [
  { name: 'homepage', path: '/homepage.html' },
  { name: 'homepage1', path: '/homepage1.html' },
  { name: 'login', path: '/login.html' },
  { name: 'registration', path: '/registration.html' },
  { name: 'trainermatch', path: '/trainermatch.html' },
  { name: 'workoutplans', path: '/workoutplans.html' },
  { name: 'dietplans', path: '/dietplans.html' },
  { name: 'gyms', path: '/gyms.html' },
];

for (const pageDef of PAGES) {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    test(`${pageDef.name} @ ${vpName}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      if (pageDef.setup) await pageDef.setup(page);
      await page.goto(pageDef.path, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await freezeMedia(page);
      const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
      const result = compareToBaseline(`${pageDef.name}-${vpName}`, shot, (pageDef.compare || {})[vpName]);
      if (result.written) return;
      expect(result.reason, result.reason).toBeUndefined();
      expect(result.ratio, `${(result.ratio * 100).toFixed(4)}% pixels differ`).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    });
  }
}
