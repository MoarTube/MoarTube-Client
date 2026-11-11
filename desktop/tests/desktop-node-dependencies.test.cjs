const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

test('Node consolidation preserves imported subpaths and notices, and hoists only identical packages with matching dependencies', async (t) => {
  const { consolidateDesktopNodeDependencies } =
    await import('../../scripts/lib/desktop-node-dependencies.mjs');
  const temporary = path.resolve('build/test');
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'moartube-node-deps-'));
  t.after(() => {
    assert.equal(path.dirname(root), temporary);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const shared = path.join(root, 'shared');
  function write(name, value) {
    const file = path.join(shared, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  }
  write('package.json', { name: 'fixture', version: '1.0.0', type: 'commonjs' });
  write(
    'consumer.cjs',
    "const semver=require('semver'); const subpath=require('semver/functions/satisfies'); console.log(semver.satisfies('5.6','5'),subpath('5.6','5'),semver.SemVer===require('semver/classes/semver')); "
  );
  write('node_modules/semver/package.json', { name: 'semver', version: '7.7.3', main: 'index.js' });
  write(
    'node_modules/semver/index.js',
    "exports.satisfies=require('./functions/satisfies'); exports.SemVer=require('./classes/semver');"
  );
  write(
    'node_modules/semver/functions/satisfies.js',
    'module.exports=(version,range)=>version.startsWith(range);'
  );
  write('node_modules/semver/classes/semver.js', 'module.exports=class SemVer {};');
  write('node_modules/semver/LICENSE', 'semver attribution');
  const parents = ['@fastify/ajv-compiler', 'ajv-formats', 'fast-json-stringify'];
  for (const parent of parents) {
    write(`node_modules/${parent}/package.json`, { name: parent, version: '1.0.0' });
    const modules = `node_modules/${parent}/node_modules`;
    write(`${modules}/ajv/package.json`, {
      name: 'ajv',
      version: '8.17.1',
      main: 'index.js',
      dependencies: { 'json-schema-traverse': '1.0.0' },
    });
    write(`${modules}/ajv/index.js`, "module.exports=require('json-schema-traverse');");
    write(`${modules}/ajv/LICENSE`, 'ajv attribution');
    write(`${modules}/json-schema-traverse/package.json`, {
      name: 'json-schema-traverse',
      version: '1.0.0',
      main: 'index.js',
    });
    write(`${modules}/json-schema-traverse/index.js`, "module.exports='shared';");
  }
  const different = path.join(root, 'different');
  fs.cpSync(shared, different, { recursive: true });
  const differentTraversal = path.join(
    different,
    'node_modules/fast-json-stringify/node_modules/json-schema-traverse/index.js'
  );
  fs.writeFileSync(differentTraversal, "module.exports='different';");
  const unknown = path.join(different, 'node_modules/semver/package.json');
  fs.writeFileSync(
    unknown,
    JSON.stringify({ name: 'semver', version: '999.0.0', main: 'index.js' })
  );

  const report = await consolidateDesktopNodeDependencies(shared);
  assert.equal(report.deduplicated.length, 2);
  assert.equal(report.bundled.length, 1);
  for (const parent of parents) {
    const local = createRequire(path.join(shared, 'node_modules', parent, 'package.json'));
    assert.equal(local.resolve('ajv'), path.join(shared, 'node_modules/ajv/index.js'));
    assert.equal(local('ajv'), 'shared');
  }
  assert.equal(
    fs.readFileSync(path.join(shared, 'node_modules/semver/LICENSE'), 'utf8'),
    'semver attribution'
  );
  assert.equal(
    fs.readFileSync(path.join(shared, 'node_modules/ajv/LICENSE'), 'utf8'),
    'ajv attribution'
  );
  assert.equal(
    execFileSync(process.execPath, [path.join(shared, 'consumer.cjs')], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    'true true true'
  );
  const preserved = await consolidateDesktopNodeDependencies(different);
  assert.equal(preserved.deduplicated.length, 0);
  assert.equal(preserved.bundled.length, 0);
  const local = createRequire(
    path.join(different, 'node_modules/fast-json-stringify/package.json')
  );
  assert.equal(local('ajv'), 'different');
  assert.equal(JSON.parse(fs.readFileSync(unknown)).version, '999.0.0');
});
