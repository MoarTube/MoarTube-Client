import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const reportRoot = process.env['MOARTUBE_E2E_REPORT_DIR'];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/support/check-node.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 1,
  // During integration work, preserve the first failure instead of cascading
  // through the remaining suite against a potentially dead shared Client.
  maxFailures: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  ...(reportRoot === undefined ? {} : { outputDir: path.join(reportRoot, 'artifacts') }),
  reporter: [
    ['./tests/e2e/support/client-logs.ts'],
    ['list'],
    [
      'html',
      {
        open: 'never',
        ...(reportRoot === undefined ? {} : { outputFolder: path.join(reportRoot, 'html') }),
      },
    ],
    [
      'json',
      {
        outputFile:
          reportRoot === undefined
            ? 'test-results/results.json'
            : path.join(reportRoot, 'results.json'),
      },
    ],
  ],
  use: {
    baseURL: process.env['MOARTUBE_CLIENT_URL'] ?? 'http://localhost:8080',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx src/moartube-client.ts',
    url: process.env['MOARTUBE_CLIENT_URL'] ?? 'http://localhost:8080/account/signin',
    reuseExistingServer: process.env['MOARTUBE_E2E_MANAGED_CLIENT'] !== '1',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
