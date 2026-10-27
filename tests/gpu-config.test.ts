import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Config } from '../src/config/index.js';
import { DEFAULT_CLIENT_SETTINGS } from '../src/config/defaults.js';

it.each([
  {
    processingAgentName: 'VideoToolbox',
    backend: 'videotoolbox',
    gpuId: 'videotoolbox:default',
    deviceIndex: 0,
  },
  { processingAgentName: 'Intel', backend: 'qsv', gpuId: 'Intel:adapter', deviceIndex: 3 },
  {
    processingAgentName: 'Intel',
    backend: 'vaapi',
    gpuId: 'Intel:0000:00:02.0',
    deviceIndex: 130,
    renderDevice: '/dev/dri/renderD130',
  },
])('loads a persisted $processingAgentName $backend selection', async (selection) => {
  vi.resetModules();
  const { Config } = await import('../src/config/index.js');
  const root = fs.mkdtempSync(path.join(tmpdir(), 'moartube-gpu-config-'));
  let config: Config | undefined;
  try {
    fs.mkdirSync(path.join(root, 'data'));
    const agent = {
      processingAgentType: 'gpu',
      processingAgentModel: 'Test hardware video',
      ...selection,
    };
    fs.writeFileSync(
      path.join(root, 'data', '_client_settings.json'),
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        processingAgent: agent,
      })
    );
    config = Config.initialize(root);
    expect(config.clientSettings.processingAgent).toEqual(agent);
  } finally {
    config?.stopWatching();
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('moartube-gpu-config-')
    ) {
      throw new Error('Unexpected GPU config test directory');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
