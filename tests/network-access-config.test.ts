import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { DEFAULT_CLIENT_SETTINGS } from '../src/config/defaults.js';

it.each([undefined, false, true])('loads the Client network default and preserves saved choice %s', async (choice) => {
  vi.resetModules();
  const { Config } = await import('../src/config/index.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-network-'));
  let config: InstanceType<typeof Config> | undefined;
  try {
    const data = path.join(root, 'data');
    fs.mkdirSync(data);
    vi.stubEnv('MOARTUBE_DATA_DIR', data);
    const settings: Record<string, unknown> = { ...DEFAULT_CLIENT_SETTINGS };
    if (choice === undefined) delete settings.allowRemoteConnections;
    else settings.allowRemoteConnections = choice;
    const file = path.join(data, '_client_settings.json');
    fs.writeFileSync(file, JSON.stringify(settings));
    config = Config.initialize(root);
    expect(config.clientSettings.allowRemoteConnections).toBe(choice ?? false);
    config.saveClientSettings({ allowRemoteConnections: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).allowRemoteConnections).toBe(true);
  } finally {
    config?.stopWatching();
    vi.unstubAllEnvs();
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^moartube-network-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
