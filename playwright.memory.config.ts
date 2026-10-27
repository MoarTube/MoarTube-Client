import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['memory-regressions.spec.ts', 'watch-comments.spec.ts'],
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/memory',
  use: {
    headless: true,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
