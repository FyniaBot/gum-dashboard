// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'https://fyniabot.github.io/gum-dashboard/',
    headless: true,
    viewport: { width: 1280, height: 800 },
    // Capture console errors
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
