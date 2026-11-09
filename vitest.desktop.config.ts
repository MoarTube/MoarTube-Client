import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Desktop authentication tests have no object-storage service dependency.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    globalSetup: [],
    include: [
      'tests/bundled-desktop.test.ts',
      'tests/bundled-credentials.test.ts',
      'tests/desktop-paths.test.ts',
      'tests/gpu-config.test.ts',
      'tests/network-access-api.test.ts',
      'tests/network-access-config.test.ts',
      'tests/startup.test.ts',
    ],
  },
});
