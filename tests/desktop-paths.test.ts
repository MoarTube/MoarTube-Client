import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { initializePaths } from '../src/config/paths.js';

afterEach(() => vi.unstubAllEnvs());

it('keeps desktop settings, media and scratch files outside installed resources', () => {
  const data = path.resolve('build/desktop/test-user-data/client');
  const root = path.resolve('build/desktop/test-install/resources/app.asar');
  vi.stubEnv('MOARTUBE_DATA_DIR', data);
  const paths = initializePaths(root, path.join(root, 'dist'));
  expect(paths.data).toBe(data);
  expect(paths.clientSettingsPath).toBe(path.join(data, '_client_settings.json'));
  expect(paths.videos).toBe(path.join(data, 'media/videos'));
  expect(paths.temp).toBe(path.join(data, 'temp'));
  expect(paths.root).toBe(root);
});

it('does not accept a relative desktop data directory', () => {
  vi.stubEnv('MOARTUBE_DATA_DIR', 'relative');
  expect(() => initializePaths(process.cwd())).toThrow('absolute writable directory');
});

it('retains the source checkout data layout without a desktop override', () => {
  vi.stubEnv('MOARTUBE_DATA_DIR', undefined);
  const root = path.resolve('build/desktop/source-checkout');
  expect(initializePaths(root).data).toBe(path.join(root, 'data'));
});
