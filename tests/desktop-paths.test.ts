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

it('preserves an explicit shared data root for source runs', () => {
  vi.stubEnv('MOARTUBE_DATA_DIR', undefined);
  vi.stubEnv('MOARTUBE_DATA_ROOT', path.resolve('build/test/unified-user-data'));
  const root = process.cwd();
  expect(initializePaths(root).data).toBe(path.resolve('build/test/unified-user-data/MoarTube/client'));
});

it('uses local checkout data for development settings, media and scratch files', () => {
  vi.stubEnv('MOARTUBE_DATA_DIR', undefined);
  vi.stubEnv('MOARTUBE_DATA_ROOT', undefined);
  vi.stubEnv('IS_DOCKER_ENVIRONMENT', undefined);
  const root = process.cwd();
  const data = path.join(root, 'data');
  for (const entry of ['src', 'dist']) {
    const paths = initializePaths(root, path.join(root, entry));
    expect(paths.data).toBe(data);
    expect(paths.clientSettingsPath).toBe(path.join(data, '_client_settings.json'));
    expect(paths.videos).toBe(path.join(data, 'media/videos'));
    expect(paths.temp).toBe(path.join(data, 'temp'));
  }
});
