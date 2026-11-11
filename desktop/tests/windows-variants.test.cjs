const { test } = require('node:test');
const assert = require('node:assert/strict');
const createConfig = require('../windows-config.cjs');
const { windowsVariant, windowsPaths } = require('../windows-variant.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('Windows variants have independent installers and outputs, with Node resources only in the bundle', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-variants-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('moartube-variants-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const layout = windowsPaths(root, '1.1.0', 'client');
  fs.mkdirSync(layout.state, { recursive: true });
  fs.writeFileSync(layout.selection, JSON.stringify({ runtimeDirectory: path.join(layout.staging, 'ffmpeg/runtime') }));
  const client = createConfig('client', root);
  const bundled = createConfig('bundled', root);
  assert.notEqual(client.appId, bundled.appId);
  assert.notEqual(client.productName, bundled.productName);
  assert.notEqual(client.directories.output, bundled.directories.output);
  assert.notEqual(client.artifactName, bundled.artifactName);
  assert.notEqual(client.nsis.artifactName, bundled.nsis.artifactName);
  for (const config of [client, bundled]) {
    assert(config.files.includes('bin/check-node-version.js'));
    assert(config.asarUnpack.includes('bin/check-node-version.js'));
    assert.equal(config.nsis.useZip, true);
    assert.equal(config.nsis.differentialPackage, false);
    assert.equal(config.nsis.oneClick, false);
    assert.equal(config.nsis.perMachine, false);
    assert.equal(config.nsis.selectPerMachineByDefault, false);
    assert.equal(config.nsis.allowElevation, true);
    assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  }
  assert.equal(client.extraMetadata.moartubeBundledNode, false);
  assert.equal(bundled.extraMetadata.moartubeBundledNode, true);
  assert(!client.extraResources.some(resource => ['node.asar', 'node.asar.unpacked', 'runtime', 'bundle.json'].includes(resource.to)));
  assert(bundled.extraResources.some(resource => resource.to === 'node.asar'));
  assert(bundled.extraResources.some(resource => resource.to === 'node.asar.unpacked/node_modules'));
  assert(!bundled.extraResources.some(resource => ['node', 'runtime'].includes(resource.to)));
  assert(client.extraResources.some(resource => resource.to === 'ffmpeg/win32-x64'));
  assert.throws(() => windowsVariant('typo'), /Unknown Windows desktop variant/);
});

test('Windows dependency packaging drops development files and preserves runtime files and licenses', async (t) => {
  const { FileMatcher, copyFiles } = require('app-builder-lib/out/fileMatcher');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-packaging-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('moartube-packaging-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const layout = windowsPaths(root, '1.1.0', 'bundled');
  fs.mkdirSync(layout.state, { recursive: true });
  fs.writeFileSync(layout.selection, JSON.stringify({ runtimeDirectory: path.join(layout.staging, 'ffmpeg/runtime') }));
  const config = createConfig('bundled', root);
  const dependencies = config.extraResources.find(resource => resource.to === 'node.asar.unpacked/node_modules');
  const retained = [
    'package/index.js', 'package/index.cjs', 'package/index.mjs', 'package/package.json',
    'package/LICENSE', 'package/NOTICE.txt', 'package/assets/style.css',
    'package/build/Release/native.node', 'package/lib/dependency.dll',
    '@scope/package/node_modules/nested/index.js',
  ];
  const excluded = [
    'package/index.js.map', 'package/types.d.ts', 'package/types.d.mts', 'package/types.d.cts',
    'package/tests/fixture.js', 'package/test/index.js', 'package/__tests__/index.js',
    'package/examples/index.js', 'package/example/index.js',
    'package/benchmark/index.js', 'package/benchmarks/index.js',
    '@scope/package/node_modules/nested/index.js.map',
  ];
  for (const name of [...retained, ...excluded]) {
    const file = path.join(dependencies.from, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, name);
  }
  const destination = path.join(root, 'output/node_modules');
  await copyFiles([new FileMatcher(dependencies.from, destination, value => value, dependencies.filter)]);
  for (const name of retained) assert.equal(fs.readFileSync(path.join(destination, name), 'utf8'), name);
  for (const name of excluded) assert(!fs.existsSync(path.join(destination, name)), name);

  // Exercise electron-builder's app dependency matcher as well as extraResources.
  const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
  const filter = getNodeModuleFileMatcher(root, root, value => value, {}, {
    config, debugLogger: { isEnabled: false },
  }).createFilter();
  for (const name of retained)
    assert(filter(path.join(root, 'node_modules', name), { isDirectory: () => false }), name);
  for (const name of excluded)
    assert(!filter(path.join(root, 'node_modules', name), { isDirectory: () => false }), name);
});
