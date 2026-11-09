const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { startNode } = require('../bundled-node.cjs');

test('the supervisor preserves the owned Node port and refuses to attach to another server', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-node-supervisor-'));
  const data = path.join(directory, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(directory, 'desktop-bootstrap.mjs'), `
    import net from 'node:net';
    const port = Number(process.env.MOARTUBE_BUNDLED_NODE_PORT);
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => process.send({ type: 'ready', port }));
    process.on('message', message => {
      if (message.type === 'shutdown') server.close(() => process.exit(0));
    });
  `);
  const children = [];
  const failures = [];
  const options = { directory, data, runtime: process.execPath, log: { write() {} },
    onFailure: message => failures.push(message), onSpawn: pid => children.push(pid) };
  let first;
  let second;
  let foreign;
  try {
    first = await startNode(options);
    const port = await first.ready;
    await first.stop();
    fs.writeFileSync(path.join(data, '_node_settings.json'), JSON.stringify({ nodeListeningPort: port }));
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
    if (foreign?.listening) await new Promise(resolve => foreign.close(resolve));
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert(path.basename(resolved).startsWith('moartube-node-supervisor-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
