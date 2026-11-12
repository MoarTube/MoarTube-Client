const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('unaudited dependency versions retain their complete manifest', async () => {
  const { desktopRuntimeFileReason, desktopRuntimeManifest } =
    await import('../../scripts/lib/desktop-runtime-dependencies.mjs');
  const original = {
    name: 'ejs',
    version: '999.0.0',
    dependencies: { jake: '^10' },
    bin: { ejs: 'bin/cli.js' },
  };
  const result = desktopRuntimeManifest(original);
  assert.deepEqual(result.manifest, original);
  assert.deepEqual(result.excludedFiles, []);
  assert.deepEqual(result.omittedDependencies, []);
  const ajv = desktopRuntimeManifest({ name: 'ajv', version: '999.0.0' });
  assert.equal(desktopRuntimeFileReason('lib/ajv.ts', ajv), undefined);
});

test('content rules preserve native addon fallbacks and Swagger spec modules', async () => {
  const { desktopRuntimeFileReason, desktopRuntimeManifest } =
    await import('../../scripts/lib/desktop-runtime-dependencies.mjs');
  const wasm = desktopRuntimeManifest({ name: '@imagemagick/magick-wasm', version: '0.0.46' });
  assert(desktopRuntimeFileReason('dist/x64/magick.wasm', wasm));
  assert.equal(desktopRuntimeFileReason('dist/x86/magick.wasm', wasm), undefined);
  assert.equal(desktopRuntimeFileReason('NOTICE', wasm), undefined);
  assert.equal(desktopRuntimeFileReason('LICENSE', wasm), undefined);
  const swagger = desktopRuntimeManifest({ name: '@fastify/swagger', version: '9.6.1' });
  assert.equal(desktopRuntimeFileReason('lib/spec/openapi/index.js', swagger), undefined);
});

test('runtime pruning removes build-only branches while retaining a shared package required at runtime', async (t) => {
  const { bundleDesktopJavaScript } = await import('../../scripts/lib/desktop-javascript.mjs');
  const temporary = path.resolve('build/test');
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'moartube-runtime-'));
  t.after(() => {
    assert.equal(path.dirname(root), temporary);
    assert(path.basename(root).startsWith('moartube-runtime-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'source');
  const destination = path.join(root, 'output');
  function write(name, content) {
    const file = path.join(source, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
  write('package.json', { name: 'fixture', version: '1.0.0', type: 'module' });
  write(
    'dist/backend.js',
    `import pure from 'pure'; import ejs from 'ejs'; import runtime from 'consumer'; console.log(pure, ejs, runtime);`
  );
  write('node_modules/pure/package.json', { name: 'pure', version: '1.0.0' });
  write('node_modules/pure/index.js', `module.exports = 'bundled';`);
  const original = {
    name: 'ejs',
    version: '4.0.1',
    dependencies: { jake: '10.0.0' },
    bin: { ejs: 'bin/cli.js' },
  };
  write('node_modules/ejs/package.json', original);
  write('node_modules/ejs/index.js', `module.exports = 'templates';`);
  write('node_modules/ejs/bin/cli.js', `throw new Error('unused CLI');`);
  write('node_modules/ejs/LICENSE', 'retained template license');
  write('node_modules/ejs/node_modules/jake/package.json', {
    name: 'jake',
    version: '10.0.0',
    dependencies: { 'only-build': '1.0.0' },
  });
  write('node_modules/ejs/node_modules/jake/index.js', `module.exports = require('only-build');`);
  write('node_modules/only-build/package.json', { name: 'only-build', version: '1.0.0' });
  write('node_modules/only-build/index.js', `module.exports = 'build-only';`);
  write('node_modules/consumer/package.json', {
    name: 'consumer',
    version: '1.0.0',
    dependencies: { jake: '11.0.0', ajv: '8.20.0' },
  });
  write('node_modules/consumer/index.js', `module.exports = require('jake') + require('ajv');`);
  write('node_modules/ajv/package.json', { name: 'ajv', version: '8.20.0', main: 'dist/ajv.js' });
  write('node_modules/ajv/dist/ajv.js', `module.exports = require('./refs/schema.json').value;`);
  write('node_modules/ajv/dist/refs/schema.json', { value: '-schema' });
  write('node_modules/ajv/lib/ajv.ts', 'source');
  write('node_modules/ajv/dist/ajv.test-d.ts', 'type test');
  write('node_modules/ajv/docs/index.md', 'documentation');
  write('node_modules/ajv/docs/example/NOTICE', 'nested attribution');
  write('node_modules/jake/package.json', { name: 'jake', version: '11.0.0' });
  write('node_modules/jake/index.js', `module.exports = 'required-runtime';`);
  const report = await bundleDesktopJavaScript({
    source,
    destination,
    entries: ['dist/backend.js'],
    external: ['ejs', 'consumer'],
  });
  assert(!fs.existsSync(path.join(destination, 'node_modules/ejs/bin')));
  assert(!fs.existsSync(path.join(destination, 'node_modules/ejs/node_modules/jake')));
  assert(!fs.existsSync(path.join(destination, 'node_modules/only-build')));
  assert(fs.existsSync(path.join(destination, 'node_modules/jake')));
  for (const name of ['lib/ajv.ts', 'dist/ajv.test-d.ts', 'docs/index.md']) {
    assert(!fs.existsSync(path.join(destination, 'node_modules/ajv', name)));
    assert(
      report.omittedPackageContents.some(
        (item) => item.path === name.split('/')[0] || item.path === name
      )
    );
  }
  assert.equal(
    fs.readFileSync(path.join(destination, 'node_modules/ajv/docs/example/NOTICE'), 'utf8'),
    'nested attribution'
  );
  assert.equal(
    fs.readFileSync(path.join(destination, 'node_modules/ejs/LICENSE'), 'utf8'),
    'retained template license'
  );
  const packaged = JSON.parse(
    fs.readFileSync(path.join(destination, 'node_modules/ejs/package.json'))
  );
  assert.deepEqual(packaged.dependencies, {});
  assert.equal(packaged.bin, undefined);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(source, 'node_modules/ejs/package.json'))),
    original
  );
  assert(
    report.omittedDependencies.some(
      (item) => item.package === 'ejs@4.0.1' && item.dependency === 'jake'
    )
  );
  fs.renameSync(source, path.join(root, 'original-disabled'));
  assert.equal(
    execFileSync(process.execPath, [path.join(destination, 'dist/backend.js')], {
      cwd: destination,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    'bundled templates required-runtime-schema'
  );
});
test('SQLite Node-API pruning retains the Windows binary and removes build headers and foreign binaries', async () => {
  const { desktopRuntimeManifest, desktopRuntimeFileReason } =
    await import('../../scripts/lib/desktop-runtime-dependencies.mjs');
  const profile = desktopRuntimeManifest(
    { name: 'better-sqlite3', version: '13.0.3', dependencies: { 'node-addon-api': '^8.0.0' } },
    { platform: 'win32', arch: 'x64' }
  );
  assert.deepEqual(profile.manifest.dependencies, {});
  for (const name of [
    'prebuilds/linux-x64.node',
    'prebuilds/win32-arm64.node',
    'src/better_sqlite3.cpp',
    'deps/sqlite3/sqlite3.c',
  ])
    assert(desktopRuntimeFileReason(name, profile), name);
  for (const name of ['prebuilds/win32-x64.node', 'lib/binding.js', 'LICENSE'])
    assert.equal(desktopRuntimeFileReason(name, profile), undefined, name);
});

for (const arch of ['x64', 'arm64'])
  test(`Linux ${arch} SQLite pruning retains only its matching ELF addon`, async () => {
    const { desktopRuntimeManifest, desktopRuntimeFileReason } =
      await import('../../scripts/lib/desktop-runtime-dependencies.mjs');
    const profile = desktopRuntimeManifest(
      { name: 'better-sqlite3', version: '13.0.3' },
      { platform: 'linux', arch }
    );
    assert.equal(desktopRuntimeFileReason(`prebuilds/linux-${arch}.node`, profile), undefined);
    assert(desktopRuntimeFileReason('prebuilds/win32-x64.node', profile));
    assert(
      desktopRuntimeFileReason(`prebuilds/linux-${arch === 'x64' ? 'arm64' : 'x64'}.node`, profile)
    );
  });
