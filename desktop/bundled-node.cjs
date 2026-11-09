const { fork, spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const linuxProcesses = require('./linux-processes.cjs');

async function startNode({ directory, runtime, data, log, onFailure, onSpawn, signal }) {
  // Retain this profile's listening port across restarts. A fresh profile gets
  // an unused port, so it can coexist with an independently running CLI Node.
  const settingsPath = path.join(data, '_node_settings.json');
  const preferred = fs.existsSync(settingsPath)
    ? Number(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).nodeListeningPort)
    : 0;
  if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65535)
    throw new Error('Invalid desktop Node listening port');
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) =>
      reject(new Error(`Could not reserve the bundled Node port ${preferred}: ${error.message}`))
    );
    server.listen(preferred, '127.0.0.1', () => {
      const selected = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
  signal?.throwIfAborted();
  fs.mkdirSync(data, { recursive: true });
  const child = fork(path.join(directory, 'desktop-bootstrap.mjs'), [], {
    execPath: runtime,
    execArgv: [],
    cwd: data,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MOARTUBE_DATA_DIR: data,
      MOARTUBE_BUNDLED_NODE_PORT: String(port),
      MOARTUBE_CLOUDFLARED_PATH: path.join(
        directory,
        `resources/cloudflared/${process.platform}-${process.arch}`,
        process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
      ),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stopping = false;
  const childIdentity =
    process.platform === 'linux' ? linuxProcesses.identity(child.pid) : undefined;
  let exited = false;
  child.stdout.on('data', (chunk) => log.write(chunk));
  child.stderr.on('data', (chunk) => log.write(chunk));
  child.once('spawn', () => onSpawn(child.pid));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The bundled Node did not become ready within 90 seconds.')),
      90_000
    );
    const rejectStartup = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    child.once('error', (error) => {
      exited = true;
      rejectStartup(error);
    });
    child.once('exit', (code) => {
      exited = true;
      const error = new Error(`The bundled Node stopped (exit ${code}).`);
      rejectStartup(error);
      if (!stopping) onFailure(error.message);
    });
    child.on('message', (message) => {
      if (message?.type === 'ready' && message.port === port) {
        clearTimeout(timer);
        resolve(port);
      }
    });
  });
  async function stop() {
    stopping = true;
    if (exited) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (process.platform === 'linux') {
          linuxProcesses.terminateOwnedTree(child.pid, childIdentity);
          return resolve();
        }
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
        });
        killer.once('error', () => {
          child.kill();
          resolve();
        });
        killer.once('exit', resolve);
      }, 12_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.connected) child.send({ type: 'shutdown' }, () => {});
    });
  }
  return { ready, stop };
}
module.exports = { startNode };
