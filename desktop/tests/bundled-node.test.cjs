const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { startNode } = require('../bundled-node.cjs');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

test('utility supervision shares shutdown and ignores late output after the log ends', async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-utility-supervisor-'));
  t.after(() => {
    assert.equal(path.dirname(data), path.resolve(os.tmpdir()));
    assert(path.basename(data).startsWith('moartube-utility-supervisor-'));
    fs.rmSync(data, { recursive: true, force: true });
  });
  let messages = 0;
  let options;
  let utilityChild;
  const log = new PassThrough();
  const logged = [];
  const logErrors = [];
  log.on('data', chunk => logged.push(chunk.toString()));
  log.on('error', error => logErrors.push(error));
  const directory = path.join(data, 'resources/node.asar');
  const { prepareDesktopTestNode } = await import('../../scripts/lib/desktop-test-profile.mjs');
  prepareDesktopTestNode(data);
  const nodeData = path.join(data, 'MoarTube/client_node/node');
  const utility = {
    fork(entry, args, configuration) {
      options = configuration;
      assert.equal(entry, path.join(directory, 'desktop-bootstrap.mjs'));
      assert.deepEqual(args, []);
      const child = Object.assign(new EventEmitter(), {
        pid: 987654,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        postMessage(message) {
          assert.deepEqual(message, { type: 'shutdown' });
          messages++;
          setTimeout(() => child.emit('exit', 0), 10);
        },
      });
      utilityChild = child;
      setImmediate(() => {
        child.emit('spawn');
        child.emit('message', {
          type: 'ready',
          port: Number(options.env.MOARTUBE_BUNDLED_NODE_PORT),
        });
      });
      return child;
    },
  };
  const failures = [];
  const service = await startNode({
    directory,
    data: nodeData,
    utility,
    log,
    onSpawn() {},
    onFailure: (message) => failures.push(message),
  });
  await service.ready;
  utilityChild.stdout.write('before shutdown');
  assert.equal(options.serviceName, 'MoarTube Node Backend');
  assert.equal(options.stdio, 'pipe');
  assert.equal(options.execPath, undefined);
  assert.equal(
    options.env.MOARTUBE_CLOUDFLARED_PATH,
    path.join(
      directory + '.unpacked',
      `resources/cloudflared/${process.platform}-${process.arch}`,
      process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
    )
  );
  const stopping = service.stop();
  assert.equal(service.stop(), stopping);
  await stopping;
  await service.stop();
  // UtilityProcess exit may arrive before its stdout/stderr are drained.
  // Reproduce that ordering after the caller closes the shared desktop log.
  log.end();
  utilityChild.stdout.write('late stdout');
  utilityChild.stderr.write('late stderr');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(logged, ['before shutdown']);
  assert.deepEqual(logErrors, []);
  assert.equal(messages, 1);
  assert.deepEqual(failures, []);
});

test('the supervisor preserves the owned Node port and refuses to attach to another server', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-node-supervisor-'));
  const data = path.join(directory, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(
    path.join(directory, 'desktop-bootstrap.mjs'),
    `
    import net from 'node:net';
    const port = Number(process.env.MOARTUBE_BUNDLED_NODE_PORT);
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => process.send({ type: 'ready', port }));
    process.on('message', message => {
      if (message.type === 'shutdown') server.close(() => process.exit(0));
    });
  `
  );
  const children = [];
  const failures = [];
  const options = {
    directory,
    data,
    runtime: process.execPath,
    log: { write() {} },
    onFailure: (message) => failures.push(message),
    onSpawn: (pid) => children.push(pid),
  };
  let first;
  let second;
  let foreign;
  try {
    first = await startNode(options);
    const port = await first.ready;
    await first.stop();
    fs.writeFileSync(
      path.join(data, '_node_settings.json'),
      JSON.stringify({ nodeListeningPort: port })
    );
    second = await startNode(options);
    assert.equal(await second.ready, port, 'Restart must preserve the public listening port');
    await second.stop();
    foreign = net.createServer();
    await new Promise((resolve, reject) => {
      foreign.once('error', reject);
      foreign.listen(port, '127.0.0.1', resolve);
    });
    await assert.rejects(startNode(options), /Could not reserve the bundled Node port/);
    assert.equal(children.length, 2, 'An occupied profile port must not start or attach to a Node');
    assert.deepEqual(failures, []);
  } finally {
    await first?.stop();
    await second?.stop();
    if (foreign?.listening) await new Promise((resolve) => foreign.close(resolve));
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert(path.basename(resolved).startsWith('moartube-node-supervisor-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
