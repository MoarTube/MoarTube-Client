const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { desktopPaths } = require('../../tooling/build-paths.cjs');
const { darwinPaths, darwinVariant, parseDarwinDesktopArgs } = require('../darwin-variant.cjs');

test('Darwin packages keep Electron, backend and FFmpeg resources on the selected architecture', () => {
  const root = path.resolve(__dirname, '../..');
  const source = readFileSync(path.join(root, 'desktop/electron-builder-darwin.cjs'), 'utf8');
  for (const arch of ['x64', 'arm64'])
    for (const variant of ['client', 'bundled']) {
      const selected = darwinVariant(variant);
      const target = `darwin-${arch}`;
      const layout = darwinPaths(root, arch, '1.1.0', variant);
      const runtime = path.join(layout.staging, 'candidate/runtime');
      const context = {
        __dirname: path.join(root, 'desktop'),
        process: { platform: 'darwin', arch, env: { MOARTUBE_DESKTOP_VARIANT: variant } },
        module: { exports: {} },
        require: (name) => {
          if (name === 'node:fs')
            return {
              readFileSync: () => JSON.stringify({ runtimeDirectory: runtime }),
            };
          if (name === '../package.json') return { version: '1.1.0' };
          if (name === '../tooling/build-paths.cjs') return { desktopPaths };
          if (name === './darwin-variant.cjs') return require('../darwin-variant.cjs');
          if (name === './builder-cache.cjs') return require('../builder-cache.cjs');
          return require(name);
        },
      };
      vm.runInNewContext(source, context);
      const config = context.module.exports;
      assert(config.files.includes('bin/check-node-version.js'));
      assert(config.asarUnpack.includes('bin/check-node-version.js'));
      assert.equal(config.directories.output, layout.packages);
      assert.equal(config.extraResources[0].from, runtime);
      assert.equal(config.extraResources[0].to, `ffmpeg/${target}`);
      assert.equal(config.directories.app, path.join(layout.staging, 'javascript/client'));
      assert.equal(config.asar.smartUnpack, false);
      assert(!config.asarUnpack.includes('node_modules/**/*'));
      assert(config.asarUnpack.includes('node_modules/**/*.dylib'));
      assert(config.files.includes('vendor/**/*'));
      assert(config.files.includes('THIRD-PARTY-NOTICES.txt'));
      assert(config.files.includes('desktop/darwin-processes.cjs'));
      assert.equal(typeof config.afterSign, 'function');
      assert.equal(config.compression, 'normal');
      assert(!config.extraResources.some((resource) => ['runtime', 'node'].includes(resource.to)));
      assert.equal(config.appId, selected.appId);
      assert.equal(config.productName, selected.productName);
      assert.equal(config.executableName, selected.executable);
      assert.equal(config.extraMetadata.moartubeBundledNode, selected.bundled);
      assert(config.files.includes('desktop/bundled-node.cjs'));
      assert.equal(
        config.extraResources.some((resource) => resource.to === 'node.asar'),
        selected.bundled
      );
      assert.equal(
        config.extraResources.some((resource) => resource.to === 'node.asar.unpacked/node_modules'),
        selected.bundled
      );
      assert.equal(
        config.extraResources.some((resource) => resource.to === 'node-SOURCES.txt'),
        selected.bundled
      );
      assert.equal(
        config.extraResources.some((resource) => resource.to === 'bundle.json'),
        selected.bundled
      );
      assert.equal(config.artifactName, `${selected.prefix}-\${version}-${target}.\${ext}`);
      assert.equal(config.mac.minimumSystemVersion, '15.0');
      assert.equal(config.mac.target.length, 2);
      for (const output of config.mac.target) assert.deepEqual(Array.from(output.arch), [arch]);
    }
});

test('Darwin variants select isolated package and report folders with shared release resources', () => {
  for (const arch of ['x64', 'arm64']) {
    const root = path.resolve(__dirname, '../..');
    const client = darwinPaths(root, arch, '1.1.0', 'client');
    const bundle = darwinPaths(root, arch, '1.1.0', 'bundled');
    assert.notEqual(client.packages, bundle.packages);
    assert.notEqual(client.reports, bundle.reports);
    assert.equal(client.release, bundle.release);
    assert.equal(client.selection, bundle.selection);
    assert.deepEqual(parseDarwinDesktopArgs([`--arch=${arch}`, '--variant=all']).variants, [
      'client',
      'bundled',
    ]);
    assert.equal(
      parseDarwinDesktopArgs([`--arch=${arch}`, '--variant=bundled']).target,
      `darwin-${arch}`
    );
    const directory = parseDarwinDesktopArgs([`--arch=${arch}`, '--variant=all', '--dir']);
    assert.equal(directory.dir, true);
    assert.deepEqual(directory.variants, ['client', 'bundled']);
    assert.equal(parseDarwinDesktopArgs([`--arch=${arch}`, '--variant=client']).dir, false);
  }
  assert.throws(() => darwinVariant('other'), /Unknown Darwin/);
  assert.throws(() => parseDarwinDesktopArgs(['--arch=ia32']), /Usage/);
  assert.throws(() => parseDarwinDesktopArgs(['--variant=other']), /Usage/);
  assert.throws(() => parseDarwinDesktopArgs(['--arch=x64', '--arch=arm64']), /Duplicate/);
});
