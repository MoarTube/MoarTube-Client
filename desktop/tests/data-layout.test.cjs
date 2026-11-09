const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { dataRoot, desktopLayout, componentDirectory, prepareData, acquireDataLock, cleanData } = require('../../src/config/data-layout.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-layout-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('moartube-layout-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function seed(directory, component) {
  fs.mkdirSync(path.join(directory, 'media'), { recursive: true });
  fs.writeFileSync(path.join(directory, `_${component}_settings.json`), JSON.stringify({ nodeListeningPort: 0, clientPort: 0, bundledNodeLoginRequired: true }));
  fs.writeFileSync(path.join(directory, 'media/keep.txt'), 'existing work');
}
test('all OS defaults put standalone and bundled data under one per-user MoarTube root', () => {
  for (const [platform, home, env, expected] of [
    ['win32', 'C:\\Users\\Alice', { APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming' }, 'C:\\Users\\Alice\\AppData\\Roaming\\MoarTube'],
    ['darwin', '/Users/alice', {}, '/Users/alice/Library/Application Support/MoarTube'],
    ['linux', '/home/alice', {}, '/home/alice/.local/share/MoarTube'],
    ['linux', '/home/alice', { XDG_DATA_HOME: '/srv/user-data' }, '/srv/user-data/MoarTube'],
  ]) {
    const options = { platform, home, env };
    const join = platform === 'win32' ? path.win32.join : path.posix.join;
    assert.equal(dataRoot(options), expected);
    assert.equal(componentDirectory('client', options), join(expected, 'client'));
    assert.equal(componentDirectory('node', options), join(expected, 'node'));
    const layout = desktopLayout(true, options);
    assert.equal(layout.client, join(expected, 'client_node/client'));
    assert.equal(layout.node, join(expected, 'client_node/node'));
    assert.equal(layout.userData, join(expected, 'client_node/client/desktop'));
    assert.equal(desktopLayout(false, options).client, join(expected, 'client'));
  }
});
test('container volumes and explicit overrides remain isolated from installation resources', () => {
  assert.equal(componentDirectory('node', { env: { IS_DOCKER_ENVIRONMENT: 'true' } }), '/data/MoarTube/node');
  const root = path.resolve('build/test/user-root');
  assert.equal(dataRoot({ env: { MOARTUBE_DATA_ROOT: root } }), path.join(root, 'MoarTube'));
  assert.equal(dataRoot({ env: { MOARTUBE_DATA_ROOT: path.join(root, 'MoarTube') } }), path.join(root, 'MoarTube'));
  assert.equal(componentDirectory('node', { env: { MOARTUBE_DATA_DIR: root } }), root);
  assert.throws(() => componentDirectory('client', { env: { MOARTUBE_DATA_DIR: 'relative' } }), /absolute/);
});
test('startup ignores legacy folders, import variables and abandoned migration journals', async t => {
  const root = fixture(t);
  for (const component of ['client', 'node']) {
    const source = path.join(root, 'MoarTube Client', component);
    seed(source, component);
    const target = path.join(root, 'MoarTube/client_node', component);
    const env = { APPDATA: root, [`MOARTUBE_${component.toUpperCase()}_MIGRATE_FROM`]: source };
    const release = await prepareData(component, { target, env, sources: [source] });
    assert.deepEqual(fs.readdirSync(target), ['.moartube-process.lock']);
    assert.throws(() => acquireDataLock(target), /already using/);
    release();
    fs.mkdirSync(path.join(target, '.migration-staging'));
    fs.writeFileSync(path.join(target, '.migration-staging', `_${component}_settings.json`), '{}');
    fs.writeFileSync(path.join(target, '.migration-in-progress.json'), JSON.stringify({ names: [`_${component}_settings.json`] }));
    (await prepareData(component, { target, env }))();
    assert(!fs.existsSync(path.join(target, `_${component}_settings.json`)));
    assert(fs.existsSync(path.join(source, `_${component}_settings.json`)));
  }
});
test('startup retains settings already in the selected data folder', async t => {
  const target = path.join(fixture(t), 'MoarTube/node');
  seed(target, 'node');
  (await prepareData('node', { target }))();
  assert.equal(fs.readFileSync(path.join(target, 'media/keep.txt'), 'utf8'), 'existing work');
});
test('clean startup resets only its component and cannot restore legacy data or erase sibling installations', async t => {
  const root = fixture(t);
  const previous = { root: process.env.MOARTUBE_DATA_ROOT, leaf: process.env.MOARTUBE_DATA_DIR, skip: process.env.MOARTUBE_SKIP_DATA_MIGRATION };
  process.env.MOARTUBE_DATA_ROOT = root;
  delete process.env.MOARTUBE_DATA_DIR;
  try {
    const client = componentDirectory('client'), node = componentDirectory('node');
    seed(client, 'client'); seed(node, 'node');
    const bundled = desktopLayout(true).node; seed(bundled, 'node');
    const release = acquireDataLock(client);
    assert.throws(() => cleanData('client'), /already using/);
    release();
    cleanData('client');
    assert(!fs.existsSync(path.join(client, '_client_settings.json')));
    assert(fs.existsSync(path.join(node, '_node_settings.json')));
    assert(fs.existsSync(path.join(bundled, '_node_settings.json')));
    const legacy = path.join(root, 'legacy'); seed(legacy, 'client');
    (await prepareData('client', { env: { ...process.env, MOARTUBE_CLIENT_MIGRATE_FROM: legacy } }))();
    assert(!fs.existsSync(path.join(client, '_client_settings.json')));
  } finally {
    for (const [key, value] of [['MOARTUBE_DATA_ROOT', previous.root], ['MOARTUBE_DATA_DIR', previous.leaf], ['MOARTUBE_SKIP_DATA_MIGRATION', previous.skip]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
