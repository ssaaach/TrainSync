// Playwright config shared by the visual-regression and end-to-end suites.
// Branded Edge (or Chrome) is used because Playwright's bundled Chromium
// cannot decode the H.264 background videos. Override with PW_CHANNEL=chrome.
const { defineConfig } = require('@playwright/test');

const PORT = process.env.TEST_PORT || 5000;

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['visual/**/*.spec.js', 'e2e/**/*.spec.js'],
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
    reuseExistingServer: true,
    timeout: 30_000,
    env: { PORT: String(PORT) },
  },
});
