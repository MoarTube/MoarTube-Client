const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('desktop bundles run without original dependencies and preserve external assets, nested versions and notices', async (t) => {
  const { bundleDesktopJavaScript } = await import('../../scripts/lib/desktop-javascript.mjs');
  const temporary = path.resolve('build/test');
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'moartube-js-'));
  t.after(() => {
    assert.equal(path.dirname(root), temporary);
    assert(path.basename(root).startsWith('moartube-js-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'source');
  const destination = path.join(root, 'output');
  function write(name, content) {
    const file = path.join(source, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
  write('package.json', {
    name: 'fixture',
    version: '1.0.0',
    type: 'module',
    dependencies: { pure: '1.0.0', assets: '1.0.0' },
  });
  write(
    'dist/backend.mjs',
    `import pure, { named } from 'pure'; import assets from 'assets'; function create(dependency) { return dependency; } console.log(pure.value, named, (await import('pure')).named, assets, import.meta.url.endsWith('/dist/backend.mjs'), create.toString().includes('create(dependency)'));`
  );
  write('node_modules/pure/package.json', {
    name: 'pure',
    version: '1.0.0',
    main: 'index.cjs',
    license: 'MIT',
  });
  write(
    'node_modules/pure/index.cjs',
    `module.exports = { value: require('node:path').basename('/bundled/dependency'), named: 'named' };`
  );
  write('node_modules/pure/LICENSE', 'bundled attribution');
  write('node_modules/assets/package.json', {
    name: 'assets',
    version: '1.0.0',
    dependencies: { nested: '2.0.0' },
    optionalDependencies: { absent: '1.0.0' },
  });
  write(
    'node_modules/assets/index.js',
    `module.exports = require('node:fs').readFileSync(__dirname + '/asset.txt', 'utf8') + require('nested');`
  );
  write('node_modules/assets/asset.txt', 'asset-');
  write('node_modules/assets/LICENSE', 'external attribution');
  write('node_modules/assets/node_modules/nested/package.json', {
    name: 'nested',
    version: '2.0.0',
  });
  write('node_modules/assets/node_modules/nested/index.js', `module.exports = 'nested';`);
  write('node_modules/unused/package.json', { name: 'unused', version: '1.0.0' });
  await bundleDesktopJavaScript({
    source,
    destination,
    entries: ['dist/backend.mjs'],
    external: ['assets'],
  });
  assert(!fs.existsSync(path.join(destination, 'node_modules/pure')));
  assert(!fs.existsSync(path.join(destination, 'node_modules/unused')));
  assert(
    fs
      .readFileSync(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), 'utf8')
      .includes('bundled attribution')
  );
  assert.equal(
    fs.readFileSync(path.join(destination, 'node_modules/assets/LICENSE'), 'utf8'),
    'external attribution'
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(destination, 'package.json'))).dependencies,
    { assets: '1.0.0' }
  );
  // Remove the source fixture so fallback resolution cannot hide missing files.
  fs.renameSync(source, path.join(root, 'original-disabled'));
  assert.equal(
    execFileSync(process.execPath, [path.join(destination, 'dist/backend.mjs')], {
      cwd: destination,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    'dependency named named asset-nested true true'
  );
});
