const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { prepareBuilderCache } = require('../builder-cache.cjs');

test('cached CommonJS tools execute inside an ESM project without altering tool bytes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-builder-cache-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('moartube-builder-cache-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const cache = path.join(root, 'build/cache/builder');
  const tool = path.join(cache, 'icons@1.2.3/icons-bundle/icon-tool.js');
  fs.mkdirSync(path.dirname(tool), { recursive: true });
  const source = 'const fs = require("node:fs"); process.stdout.write(typeof fs.readFileSync);';
  fs.writeFileSync(tool, source);
  const invoke = () => spawnSync(process.execPath, [tool], { encoding: 'utf8' });
  const before = invoke();
  assert.notEqual(before.status, 0);
  assert.match(before.stderr, /require is not defined in ES module scope/);
  prepareBuilderCache(cache);
  const after = invoke();
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, 'function');
  assert.equal(fs.readFileSync(tool, 'utf8'), source);
  const manifest = fs.readFileSync(path.join(cache, 'package.json'), 'utf8');
  prepareBuilderCache(cache);
  assert.equal(fs.readFileSync(path.join(cache, 'package.json'), 'utf8'), manifest);
});

test('cache preparation leaves default locations alone and rejects relative overrides', () => {
  assert.doesNotThrow(() => prepareBuilderCache(undefined));
  assert.throws(() => prepareBuilderCache('relative/cache'), /absolute path/);
});
