// This entry is also used by cluster workers. Only the primary talks to Electron.
import cluster from 'node:cluster';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

if (cluster.isPrimary) {
  if (!process.connected || !process.env.MOARTUBE_DATA_DIR) throw new Error('Desktop supervisor required');
  const settingsPath = path.join(process.env.MOARTUBE_DATA_DIR, '_node_settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {
    workerCount: 4,
    databaseConfig: { databaseDialect: 'sqlite' },
    storageConfig: { storageMode: 'filesystem' },
  };
  // Credentials belong to this private desktop profile, never a CLI Node profile.
  for (const field of ['username', 'password']) {
    if (!settings[field]) {
      settings[field] = Buffer.from(bcrypt.hashSync('admin', 10)).toString('base64');
    }
  }
  settings.nodeListeningPort = Number(process.env.MOARTUBE_BUNDLED_NODE_PORT);
  // An owned desktop Node is local unless this profile explicitly opts in.
  if (typeof settings.allowRemoteConnections !== 'boolean') settings.allowRemoteConnections = false;
  if (['127.0.0.1', 'localhost'].includes(settings.publicNodeAddress)) {
    settings.publicNodePort = settings.nodeListeningPort;
  }
  settings.isSecure = false;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  let stopping = false;
  let loaded = false;
  const shutdown = () => {
    stopping = true;
    if (loaded) process.emit('SIGTERM');
  };
  process.on('message', (message) => { if (message?.type === 'shutdown') shutdown(); });
  process.on('disconnect', shutdown);
  let ready = false;
  cluster.on('message', (_worker, message) => {
    if (!ready && !stopping && message?.cmd === 'worker_http_ready') {
      ready = true;
      process.send?.({ type: 'ready', port: message.port });
    }
  });
  await import('./dist/moartube-node.js');
  loaded = true;
  if (stopping) shutdown();
} else {
  await import('./dist/moartube-node.js');
}
