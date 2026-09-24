// Playwright config shared by the visual-regression and end-to-end suites.
// Runs its own server on a dedicated port against the disposable test DB, so
// it never reuses a dev server or touches live data.
// Branded Edge (or Chrome) is used because Playwright's bundled Chromium
// cannot decode the H.264 background videos. Override with PW_CHANNEL=chrome.
const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.TEST_PORT) || 5055;
const TEST_DB = process.env.TEST_DB_NAME || 'trainsync_test';

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['visual/**/*.spec.js', 'e2e/**/*.spec.js'],
  globalSetup: require.resolve('./tests/setup/globalSetup.js'),
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL || 'msedge',
    headless: true,
  },
  webServer: {
    command: 'node server.js',
    url: `http://localhost:${PORT}/homepage.html`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), DB_NAME: TEST_DB, NODE_ENV: 'test' },
  },
});
