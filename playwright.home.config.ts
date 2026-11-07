import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'home-page.spec.ts',
  outputDir: 'test-results/home-page',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8000 },
  reporter: [['list']],
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
