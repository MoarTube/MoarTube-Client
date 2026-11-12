const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const {
  linuxPaths,
  linuxVariant,
  parseLinuxDesktopArgs,
  deferImageProbeToVm,
} = require('../linux-variant.cjs');

test('only cross-architecture ARM64 builds defer the WASM execution probe to the full-system VM', () => {
  for (const engine of ['x86_64', 'amd64'])
    assert.equal(deferImageProbeToVm('arm64', engine), true);
  for (const engine of ['arm64', 'aarch64', undefined])
    assert.equal(deferImageProbeToVm('arm64', engine), false);
  for (const engine of ['x86_64', 'amd64', 'arm64', undefined])
    assert.equal(deferImageProbeToVm('x64', engine), false);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-linux-variants-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('moartube-linux-variants-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
test('Linux variants have independent package identities, resources and reports on both architectures', (t) => {
  const source = fs.readFileSync(path.join(__dirname, '../linux-config.cjs'), 'utf8');
  for (const arch of ['x64', 'arm64']) {
    const root = fixture(t);
    const layout = linuxPaths(root, arch, '1.1.0', 'client');
    fs.mkdirSync(layout.state, { recursive: true });
    fs.writeFileSync(
      layout.selection,
      JSON.stringify({
        runtimeDirectory: path.join(layout.staging, 'ffmpeg/runtime'),
      })
    );
    const context = {
      __dirname: path.join(__dirname, '..'),
      process: { platform: 'linux', arch, env: {} },
      module: { exports: {} },
      require: createRequire(path.join(__dirname, '../linux-config.cjs')),
    };
    vm.runInNewContext(source, context);
    const client = context.module.exports('client', root),
      bundle = context.module.exports('bundled', root);
    for (const config of [client, bundle]) {
      assert(config.files.includes('bin/check-node-version.js'));
      assert(config.files.includes('vendor/**/*'));
      assert.equal(config.deb.compression, 'zst');
      assert.equal(config.directories.app, path.join(layout.staging, 'javascript/client'));
      assert(!config.asarUnpack.includes('vendor/**/*'));
      assert(!config.asarUnpack.includes('node_modules/**/*'));
      assert(config.asarUnpack.includes('node_modules/@imagemagick/magick-wasm/**/*'));
      assert.equal(config.asar.smartUnpack, false);
      assert(config.asarUnpack.includes('bin/check-node-version.js'));
    }
    assert.notEqual(client.appId, bundle.appId);
    assert.notEqual(client.executableName, bundle.executableName);
    assert.notEqual(client.deb.packageName, bundle.deb.packageName);
    assert.notEqual(client.extraMetadata.desktopName, bundle.extraMetadata.desktopName);
    assert.notEqual(client.directories.output, bundle.directories.output);
    assert.notEqual(
      linuxPaths(root, arch, '1.1.0', 'client').reports,
      linuxPaths(root, arch, '1.1.0', 'bundled').reports
    );
    assert(!client.extraResources.some((resource) => resource.to === 'node'));
    assert(bundle.extraResources.some((resource) => resource.to === 'node.asar'));
    assert(
      bundle.extraResources.some((resource) => resource.to === 'node.asar.unpacked/node_modules')
    );
    assert.equal(
      client.extraResources.some((resource) => resource.to === 'runtime'),
      false
    );
    assert.equal(client.asarUnpack.includes('node_modules/**/*'), false);
    assert.equal(client.extraMetadata.moartubeBundledNode, false);
    assert.equal(bundle.extraMetadata.moartubeBundledNode, true);
  }
  assert.deepEqual(parseLinuxDesktopArgs(['--arch=arm64', '--variant=bundled']).variants, [
    'bundled',
  ]);
  assert.deepEqual(parseLinuxDesktopArgs(['--variant=all']).variants, ['client', 'bundled']);
  assert.throws(() => linuxVariant('client-only'), /Unknown/);
});

test('each Linux release target accepts only its own binary pair and matching sources', async (t) => {
  const { collectReleaseAssets } = await import('../../scripts/lib/draft-release.mjs');
  for (const arch of ['x64', 'arm64'])
    for (const variant of ['client', 'bundled']) {
      const directory = fixture(t),
        base = `linux-${arch}`,
        target = `${base}-${variant}`;
      const prefix = linuxVariant(variant).prefix;
      const names = [
        `${prefix}-1.1.0-${base}.deb`,
        `${prefix}-1.1.0-${base}-portable.tar.gz`,
        `9.0.2-moartube-${base}-test-sources.tar.xz`,
        ...(variant === 'bundled'
          ? [`MoarTube-Client-Node-1.1.0-${base}-0123456789ab-sources.zip`]
          : []),
      ];
      for (const name of names) fs.writeFileSync(path.join(directory, name), name);
      const checksum = path.join(directory, `SHA256SUMS-${target}.txt`);
      fs.writeFileSync(
        checksum,
        names
          .map((name) => `${createHash('sha256').update(name).digest('hex')}  ${name}`)
          .join('\n') + '\n'
      );
      fs.writeFileSync(
        path.join(directory, `RELEASE-NOTES-${target}.md`),
        names
          .slice(2)
          .map(
            (name) => `https://github.com/MoarTube/MoarTube-Client/releases/download/v1.1.0/${name}`
          )
          .join('\n')
      );
      const options = {
        directory,
        target,
        version: '1.1.0',
        repo: 'MoarTube/MoarTube-Client',
        tag: 'v1.1.0',
      };
      assert.equal((await collectReleaseAssets(options)).length, names.length + 2);
      fs.appendFileSync(path.join(directory, names[0]), 'changed');
      await assert.rejects(collectReleaseAssets(options), /checksum mismatch/);
    }
});

test('Linux Client and Client + Node use separate workflows for each architecture', () => {
  const yaml = require('yaml');
  const root = path.resolve(__dirname, '../..');
  const all = yaml.parse(
    fs.readFileSync(path.join(root, '.github/workflows/electron-build-all.yml'), 'utf8')
  );
  for (const arch of ['x64', 'arm64'])
    for (const [flavor, variant] of [
      ['client', 'client'],
      ['client-node', 'bundled'],
    ]) {
      const name = `electron-build-linux-${flavor}-${arch}.yml`;
      const source = fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8');
      const workflow = yaml.parse(source);
      assert(workflow.on.workflow_call);
      assert(workflow.jobs[`linux-${flavor}`]);
      assert(source.includes(`--variant=${variant}`));
      assert(source.includes(`SHA256SUMS-linux-${arch}-${variant}.txt`));
      assert.equal(source.includes('Check out bundled MoarTube Node'), variant === 'bundled');
      assert(Object.values(all.jobs).some((job) => job.uses === `./.github/workflows/${name}`));
    }
});
