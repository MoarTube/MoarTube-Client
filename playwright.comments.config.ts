import { defineConfig } from '@playwright/test';
import base from './playwright.memory.config';

export default defineConfig({
  ...base,
  testMatch: 'watch-comments.spec.ts',
  outputDir: 'test-results/comments',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
