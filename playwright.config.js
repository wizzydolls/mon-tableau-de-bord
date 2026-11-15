// Configuration Playwright. La page est servie par tests/serve.js (Node seul, aucune dépendance).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 900 },
  },
  webServer: {
    command: 'node tests/serve.js',
    port: 4173,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
