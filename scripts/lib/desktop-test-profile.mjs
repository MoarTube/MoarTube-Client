import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Routine desktop tests must not create public tunnels or consume provider quotas.
export function prepareDesktopTestNode(profile) {
  const settings = path.join(profile, 'MoarTube/client_node/node/_node_settings.json');
  mkdirSync(path.dirname(settings), { recursive: true });
  writeFileSync(
    settings,
    JSON.stringify({
      workerCount: 4,
      nodeListeningPort: 0,
      databaseConfig: { databaseDialect: 'sqlite' },
      storageConfig: { storageMode: 'filesystem' },
      isCloudflareTunnelEnabled: false,
    }),
    { flag: 'wx' }
  );
}
