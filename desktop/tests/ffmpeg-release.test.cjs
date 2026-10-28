const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('separates runtime and corresponding sources, retaining binary identity and rejecting tampering', async (t) => {
  const { stageDesktopFfmpeg, sha256 } = await import('../../scripts/lib/desktop-ffmpeg.mjs');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-release-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const candidate = path.join(temporary, 'candidate');
  const put = (name, value) => {
    const file = path.join(candidate, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
    return file;
  };
  const buildId = 'test-build';
  const files = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    const binaryPath = `${buildId}/${name}.exe`;
    files[name] = { path: binaryPath, sha256: sha256(put(binaryPath, name)) };
  }
  const source = put('sources/upstream.tar.gz', 'test upstream source bytes');
  put(
    'recipe/tooling/ffmpeg/sources.lock.json',
    JSON.stringify({
      sources: [{ id: 'upstream', archive: 'upstream.tar.gz', sha256: sha256(source) }],
    })
  );
  put('recipe/tooling/ffmpeg/patches/amd.patch', 'test AMD patch');
  put('licenses/COPYING', 'test GPL license');
  put('client-command-snapshot/commands.ts', 'test client commands');
  put('reports/result.json', '{}');
  put('BUILD.txt', 'build instructions');
  put('NOTICES.txt', 'See licenses/, sources/ and recipe/.');
  put('manifest.json', JSON.stringify({ schemaVersion: 1, target: 'win32-x64', buildId, files }));
  put('provenance.json', '{}');
  const runtime = path.join(temporary, 'runtime');
  const sources = path.join(temporary, 'sources');
  stageDesktopFfmpeg(candidate, runtime, sources);
  assert.equal(sha256(path.join(runtime, files.ffmpeg.path)), files.ffmpeg.sha256);
  assert.equal(fs.existsSync(path.join(runtime, 'licenses/COPYING')), true);
  assert.equal(fs.existsSync(path.join(runtime, 'sources')), false);
  assert.equal(fs.existsSync(path.join(runtime, 'recipe')), false);
  assert.equal(fs.existsSync(path.join(sources, files.ffmpeg.path)), false);
  assert.equal(fs.existsSync(path.join(sources, 'sources/upstream.tar.gz')), true);
  assert.equal(fs.existsSync(path.join(sources, 'recipe/tooling/ffmpeg/patches/amd.patch')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sources, 'manifest.json'))).files, files);
  assert.match(fs.readFileSync(path.join(runtime, 'NOTICES.txt'), 'utf8'), /SOURCES.txt/);
  fs.writeFileSync(source, 'tampered');
  assert.throws(() => stageDesktopFfmpeg(candidate, runtime, sources), /source checksum mismatch/);
  put(files.ffmpeg.path, 'tampered binary');
  assert.throws(() => stageDesktopFfmpeg(candidate, runtime, sources), /ffmpeg checksum mismatch/);
});
