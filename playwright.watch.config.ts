import { defineConfig } from '@playwright/test';
import base from './playwright.comments.config';
export default defineConfig({
  ...base,
  testMatch: 'watch-page.spec.ts',
  outputDir: 'test-results/watch-page',
});
