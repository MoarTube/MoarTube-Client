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
    assert.equal(config.nsis.oneClick, false);
    assert.equal(config.nsis.perMachine, false);
    assert.equal(config.nsis.selectPerMachineByDefault, false);
    assert.equal(config.nsis.allowElevation, true);
    assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  }
  assert.equal(client.extraMetadata.moartubeBundledNode, false);
  assert.equal(bundled.extraMetadata.moartubeBundledNode, true);
  assert(!client.extraResources.some(resource => ['node', 'node/node_modules', 'runtime', 'bundle.json'].includes(resource.to)));
  assert(bundled.extraResources.some(resource => resource.to === 'node/node_modules'));
  assert(client.extraResources.some(resource => resource.to === 'ffmpeg/win32-x64'));
  assert.throws(() => windowsVariant('typo'), /Unknown Windows desktop variant/);
});
