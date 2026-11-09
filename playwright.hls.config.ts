import { defineConfig } from '@playwright/test';
import base from './playwright.comments.config';

export default defineConfig({
  ...base,
  testMatch: 'hls-url-policy.spec.ts',
  outputDir: 'test-results/hls-url-policy',
});
