const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

for (const target of ['win32-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'])
  test(
    `${target} source archive preserves original materials and hashes without copying private data or binaries`,
    { skip: process.platform !== 'win32' },
    async (t) => {
      const {
        createDesktopSourceArchive,
        addDesktopSourceNotes,
        clientSourceFiles,
        nodeSourceFiles,
      } = await import('../../scripts/lib/desktop-source.mjs');
      const temporary = path.resolve('build/test');
      fs.mkdirSync(temporary, { recursive: true });
      const root = fs.mkdtempSync(path.join(temporary, 'moartube-source-'));
      t.after(() => {
        assert.equal(path.dirname(root), temporary);
        assert(path.basename(root).startsWith('moartube-source-'));
        fs.rmSync(root, { recursive: true, force: true });
      });
      const client = path.join(root, 'client-input');
      const node = path.join(root, 'node-input');
      function write(base, name, value) {
        const file = path.join(base, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, value);
      }
      for (const [directory, names] of [
        [client, clientSourceFiles],
        [node, nodeSourceFiles],
      ])
        for (const name of names)
          write(
            directory,
            path.extname(name) || name.endsWith('/LICENSE') ? name : `${name}/keep.txt`,
            `original ${name}`
          );
      write(node, 'node_modules/native/src/database.c', 'native source');
      write(node, 'node_modules/native/build/Release/database.node', 'compiled addon');
      write(node, 'node_modules/native/build/Release/library.dylib', 'compiled Mac library');
      write(client, 'src/utils/image-runtime/profiles/NOTICE.txt', 'profile provenance');
      write(node, 'resources/cloudflared/win32-x64/cloudflared.exe', 'compiled tunnel');
      write(node, 'data/credentials.json', 'private node data');
      write(client, '.env', 'private environment');
      write(client, 'data/settings.json', 'private client data');
      const release = path.join(root, 'release');
      const source = await createDesktopSourceArchive({
        root: client,
        target,
        nodeSource: node,
        staging: path.join(root, 'source-tree'),
        releaseDirectory: release,
        version: '1.1.0',
        releaseTag: 'test/tag',
        build: { nodeVersion: '2.0.0', runtimeVersion: 'v24.22.1', runtimeFiles: {} },
        writeArchive: (file, directory) =>
          execFileSync('tar.exe', ['-a', '-cf', file, '-C', directory, '.'], { windowsHide: true }),
      });
      const archive = path.join(release, source.archive);
      const hash = (data) => createHash('sha256').update(data).digest('hex');
      assert.equal(hash(fs.readFileSync(archive)), source.sha256);
      assert(source.archive.includes(source.sha256.slice(0, 12)));
      assert(source.url.includes('/test%2Ftag/'));
      const extracted = path.join(root, 'extracted');
      fs.mkdirSync(extracted);
      execFileSync('tar.exe', ['-xf', archive, '-C', extracted], { windowsHide: true });
      const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'SOURCE-MANIFEST.json')));
      for (const item of manifest.files)
        assert.equal(
          hash(fs.readFileSync(path.join(extracted, item.path))),
          item.sha256,
          item.path
        );
      const readme = fs.readFileSync(path.join(extracted, 'README.txt'), 'utf8');
      if (target === 'linux-arm64') {
        assert(source.archive.includes('-linux-arm64-'));
        assert(readme.includes('desktop:build:linux:client-node -- --arch=arm64'));
        assert(readme.includes('Both backends run through Electron'));
        assert(readme.includes('No standalone Node executable is distributed'));
        assert(readme.includes('Client dependencies and shared JavaScript stay in app.asar'));
      }
      if (target.startsWith('darwin-')) {
        assert(source.archive.includes(`-${target}-`));
        assert(readme.includes(`native macOS 15+ ${target.slice(7)}`));
        assert(
          readme.includes(
            `desktop:build:darwin${target.endsWith('arm64') ? ':arm64' : ''}:client-node`
          )
        );
        assert(readme.includes('Client dependencies and shared JavaScript stay in app.asar'));
        assert(readme.includes('No standalone Node executable is distributed'));
      }
      const names = manifest.files.map((item) => item.path);
      assert(names.includes('node/src/keep.txt'));
      assert(names.includes('client/scripts/keep.txt'));
      assert(names.includes('node/node_modules/native/src/database.c'));
      assert(names.includes('client/src/utils/image-runtime/profiles/NOTICE.txt'));
      assert(names.includes('node/resources/cloudflared/LICENSE'));
      assert(
        !names.some((name) =>
          /credentials|settings\.json|\.env$|\.(exe|node|dll|dylib)$/.test(name)
        )
      );
      assert.equal(
        fs.readFileSync(path.join(extracted, 'node/package.json'), 'utf8'),
        'original package.json'
      );
      const notes = path.join(root, 'NOTES.md');
      fs.writeFileSync(notes, 'Original release notes\n');
      addDesktopSourceNotes(notes, source);
      addDesktopSourceNotes(notes, source);
      const text = fs.readFileSync(notes, 'utf8');
      assert.equal(text.split(source.url).length, 2);
      assert(text.includes(source.sha256));
    }
  );
