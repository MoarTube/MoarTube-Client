import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'win32', 'This checks the native Windows connector process');
const packageRoot = path.resolve(process.env.MOARTUBE_NODE_PACKAGE ?? '../MoarTube-Node');
const require = createRequire(path.join(packageRoot, 'package.json'));
const bcrypt = require('bcryptjs');
const root = path.resolve('temp/tunnel-m6');
fs.mkdirSync(root, { recursive: true });
const directory = fs.mkdtempSync(path.join(root, 'windows-runtime-'));
const data = path.join(directory, 'data');
const otherCwd = path.join(directory, 'different-cwd');
fs.mkdirSync(data);
fs.mkdirSync(otherCwd);
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve, reject) =>
  listener.close((error) => (error ? reject(error) : resolve()))
);
const direct = `http://127.0.0.1:${port}`;
const credentials = {
  username: 'm6-' + randomBytes(5).toString('hex'),
  password: randomBytes(24).toString('hex'),
};
const file = path.join(data, '_node_settings.json');
fs.writeFileSync(
  file,
  JSON.stringify({
    nodeListeningPort: port,
    publicNodeProtocol: 'http',
    publicNodeAddress: '127.0.0.1',
    publicNodePort: port,
    username: Buffer.from(bcrypt.hashSync(credentials.username, 4)).toString('base64'),
    password: Buffer.from(bcrypt.hashSync(credentials.password, 4)).toString('base64'),
    databaseConfig: { databaseDialect: 'sqlite' },
    storageConfig: { storageMode: 'filesystem' },
  }),
  { mode: 0o600 }
);
const executable = path.join(packageRoot, 'resources/cloudflared/win32-x64/cloudflared.exe');
assert.equal(
  createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
  '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343'
);
const targets = fs
  .readdirSync(path.join(packageRoot, 'resources/cloudflared'))
  .filter((name) => /^(win32|linux|darwin)-/.test(name));
assert.deepEqual(targets, ['win32-x64'], 'Host-only npm installation');
const marker = path.join(directory, 'stop');
const wrapper = path.join(directory, 'launch.mjs');
// Windows process.kill terminates immediately. Exercise the real JS shutdown
// handler using a primary-only marker, without changing the installed runtime.
fs.writeFileSync(
  wrapper,
  `import fs from 'node:fs';import cluster from 'node:cluster';if(cluster.isPrimary){const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(timer);process.emit('SIGTERM');}},100);timer.unref();}await import(${JSON.stringify(pathToFileURL(path.join(packageRoot, 'bin/moartube-node-start')).href)});`
);
const env = {
  ...process.env,
  NODE_ENV: 'production',
  IS_DOCKER_ENVIRONMENT: 'false',
  MOARTUBE_DATA_DIR: data,
  MOARTUBE_WORKERS: '2',
  HOST: '127.0.0.1',
};
delete env.MOARTUBE_CLOUDFLARED_PATH;
let child, exit, log, token;
const results = [];
async function until(action, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await delay(500);
  }
  throw last ?? new Error('Native smoke readiness timeout');
}
function launch() {
  fs.rmSync(marker, { force: true });
  log = fs.openSync(path.join(directory, `node-${results.length}.log`), 'a');
  child = spawn(process.execPath, [wrapper], {
    cwd: otherCwd,
    env,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  exit = once(child, 'exit');
}
function connectors() {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${child.pid}" | Where-Object Name -eq 'cloudflared.exe' | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 }
  ).trim();
  if (!output) return [];
  const result = JSON.parse(output);
  return Array.isArray(result) ? result : [result];
}
async function request(route, payload, authenticated = true) {
  const response = await fetch(direct + route, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated && token ? { authorization: 'Bearer ' + token } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  assert.ok(
    response.ok && !result.isError,
    `Native request failed: ${route}, HTTP ${response.status}`
  );
  return result;
}
async function localReady() {
  await until(
    async () =>
      (await fetch(direct + '/status/heartbeat', { signal: AbortSignal.timeout(5000) })).ok
  );
  token = (
    await request(
      '/account/signin',
      {
        ...credentials,
        moarTubeNodeHttpProtocol: 'http',
        moarTubeNodeIp: '127.0.0.1',
        moarTubeNodePort: String(port),
      },
      false
    )
  ).token;
  assert.ok(token);
}
async function running() {
  const snapshot = await until(async () => {
    const { tunnel } = await request('/settings/cloudflare/tunnel');
    return tunnel.status === 'running' && tunnel.mode === 'quick' && tunnel;
  });
  const processes = connectors();
  assert.equal(processes.length, 1);
  assert.equal(path.resolve(processes[0].ExecutablePath).toLowerCase(), executable.toLowerCase());
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).cloudflareTunnelName, snapshot.name);
  await until(
    async () =>
      (
        await fetch(snapshot.publicUrl + '/status/heartbeat', {
          signal: AbortSignal.timeout(10000),
        })
      ).ok
  );
  return snapshot;
}
async function stop() {
  if (!child) return;
  fs.writeFileSync(marker, 'stop');
  const result = await Promise.race([
    exit,
    delay(25000).then(() => {
      throw new Error('Native Node did not shut down gracefully');
    }),
  ]);
  assert.equal(result[0], 0);
  assert.equal(connectors().length, 0);
  fs.closeSync(log);
  child = undefined;
}
try {
  launch();
  await localReady();
  const first = await running();
  const settings = await request('/settings');
  assert.equal(
    settings.nodeSettings?.isCloudflareTunnelEnabled ?? settings.isCloudflareTunnelEnabled,
    true
  );
  results.push(
    'fresh quick startup, saved random name, package-relative Windows executable and public HTTP'
  );
  await request('/settings/cloudflare/tunnel/toggle', { isEnabled: false });
  await until(() => connectors().length === 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).cloudflareTunnelName, first.name);
  await stop();
  launch();
  await localReady();
  assert.equal(connectors().length, 0);
  assert.equal((await request('/settings/cloudflare/tunnel')).tunnel.status, 'stopped');
  results.push(
    'disabled preference and saved name survived restart; zero connectors and local HTTP available'
  );
  await request('/settings/cloudflare/tunnel/toggle', { isEnabled: true });
  const next = await running();
  assert.notEqual(next.name, first.name);
  results.push('re-enable obtained a fresh quick hostname; exactly one native connector');
  await stop();
  results.push('graceful primary shutdown stopped the connector; exit 0');
  fs.writeFileSync(
    path.join(root, 'windows-smoke-results.json'),
    JSON.stringify(
      {
        platform: process.platform,
        architecture: process.arch,
        packageRoot,
        hostOnly: targets,
        results,
      },
      null,
      2
    )
  );
  console.log('Native Windows npm-consumer lifecycle checks passed.');
} finally {
  if (child) {
    try {
      await stop();
    } catch (error) {
      for (const process of connectors())
        execFileSync('taskkill.exe', ['/PID', String(process.ProcessId), '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      child.kill();
      throw error;
    }
  }
}
