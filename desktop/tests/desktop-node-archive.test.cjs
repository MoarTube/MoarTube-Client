const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const target of ['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'])
  test(`${target} Node ASAR keeps JavaScript archived and external resources on disk`, async (t) => {
    const { archiveDesktopNode } = await import('../../scripts/lib/desktop-node-archive.mjs');
    const asar = require('@electron/asar');
    const temporary = path.resolve('build/test');
    fs.mkdirSync(temporary, { recursive: true });
    const root = fs.mkdtempSync(path.join(temporary, 'moartube-node-archive-'));
    t.after(() => {
      assert.equal(path.dirname(root), temporary);
      assert(path.basename(root).startsWith('moartube-node-archive-'));
      fs.rmSync(root, { recursive: true, force: true });
    });
    const node = path.join(root, 'node');
    const archived = [
      'dist/moartube-node.js',
      'desktop-bootstrap.mjs',
      'desktop-preflight.mjs',
      'node_modules/better-sqlite3/lib/index.js',
      'node_modules/better-sqlite3/LICENSE',
      'SOURCES.txt',
    ];
    const unpacked = [
      `node_modules/better-sqlite3/prebuilds/${target}.node`,
      `resources/cloudflared/${target}/cloudflared${target.startsWith('win32') ? '.exe' : ''}`,
      'dist/public/index.ejs',
      'node_modules/thread-stream/lib/worker.js',
      'node_modules/pino/lib/worker.js',
      ...(target.startsWith('darwin-') ? ['node_modules/native/library.dylib'] : []),
    ];
    for (const name of [...archived, ...unpacked]) {
      const file = path.join(node, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, name);
    }
    const archive = await archiveDesktopNode(node, target);
    for (const name of archived) {
      assert(!asar.statFile(archive, path.normalize(name)).unpacked, name);
      assert.equal(asar.extractFile(archive, path.normalize(name)).toString(), name);
    }
    for (const name of unpacked) {
      assert.equal(asar.statFile(archive, path.normalize(name)).unpacked, true, name);
      assert.equal(fs.readFileSync(path.join(archive + '.unpacked', name), 'utf8'), name);
    }
  });
