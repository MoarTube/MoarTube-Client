const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { desktopPaths } = require('../../tooling/build-paths.cjs');

test('Darwin packages keep Electron, backend and FFmpeg resources on the selected architecture', () => {
  const root = path.resolve(__dirname, '../..');
  const source = readFileSync(path.join(root, 'desktop/electron-builder-darwin.cjs'), 'utf8');
  for (const arch of ['x64', 'arm64']) {
    const target = `darwin-${arch}`;
    const layout = desktopPaths(root, target, '1.1.0');
    const runtime = path.join(layout.staging, 'candidate/runtime');
    const node = path.join(layout.staging, 'node');
    const context = {
      __dirname: path.join(root, 'desktop'),
      process: { platform: 'darwin', arch, env: {} },
      module: { exports: {} },
      require: (name) => {
        if (name === 'node:fs')
          return {
            readFileSync: () =>
              JSON.stringify({ runtimeDirectory: runtime, nodeRuntimeDirectory: node }),
          };
        if (name === '../package.json') return { version: '1.1.0' };
        if (name === '../tooling/build-paths.cjs') return { desktopPaths };
        if (name === './builder-cache.cjs') return require('../builder-cache.cjs');
        return require(name);
      },
    };
    vm.runInNewContext(source, context);
    const config = context.module.exports;
    assert.equal(config.directories.output, layout.packages);
    assert.equal(config.extraResources[0].from, runtime);
    assert.equal(config.extraResources[0].to, `ffmpeg/${target}`);
    assert.equal(config.extraResources[1].from, node);
    assert.equal(config.artifactName, `MoarTube-Client-\${version}-${target}.\${ext}`);
    assert.equal(config.mac.minimumSystemVersion, '15.0');
    assert.equal(config.mac.target.length, 2);
    for (const output of config.mac.target) assert.deepEqual(Array.from(output.arch), [arch]);
  }
});
