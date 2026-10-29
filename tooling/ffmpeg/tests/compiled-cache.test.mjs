import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { compiledCacheKey, verifyCompiledCache } from '../scripts/compiled-cache.mjs';
import { windowsCommandFiles, windowsDocumentation } from '../scripts/recipe-hash.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
function fixture(t, target) {
  const root = mkdtempSync(path.join(tmpdir(), 'moartube-compiled-cache-'));
  t.after(() => {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('moartube-compiled-cache-')
    )
      throw new Error('Invalid fixture root');
    rmSync(root, { recursive: true, force: true });
  });
  const put = (name, value) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof value === 'object' ? JSON.stringify(value) : value);
    return file;
  };
  put('tooling/build-paths.cjs', 'build paths');
  put('tooling/ffmpeg/recipe.txt', 'locked recipe');
  put('tooling/ffmpeg/sources.lock.json', {
    sources: [{ id: 'ffmpeg', archive: 'ffmpeg.tar.xz', sha256: hash('source') }],
  });
  for (const file of windowsCommandFiles) put(file, 'command snapshot');
  for (const file of windowsDocumentation) put(`docs/${file}`, 'documentation');
  const { recipe } = compiledCacheKey(root, target);
  const buildId = '9.0.2-test';
  const base = `build/ffmpeg`;
  const windows = target === 'win32-x64';
  const candidate = `${base}/candidates/${target}/${buildId}${windows ? '' : '/runtime'}`;
  const files = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    const filename = name + (windows ? '.exe' : '');
    files[name] = { path: `${buildId}/${filename}`, sha256: hash(name) };
    put(`${candidate}/${files[name].path}`, name);
    put(`${base}/install/${target}/bin/${filename}`, name);
  }
  put(`${candidate}/manifest.json`, {
    schemaVersion: 1,
    target,
    buildId,
    qualification: { compiledFeatures: 'passed', softwareSmoke: 'passed' },
    files,
  });
  put(`${candidate}/provenance.json`, { recipeSha256: recipe });
  put(
    windows
      ? `${candidate}/sources/ffmpeg.tar.xz`
      : `${base}/candidates/${target}/${buildId}/source/sources/ffmpeg.tar.xz`,
    'source'
  );
  const binarySha256 = Object.fromEntries(
    Object.entries(files).map(([name, entry]) => [name, entry.sha256])
  );
  put(`${base}/reports/${target}/${target.startsWith('darwin-') ? 'features' : 'result'}.json`, {
    compiledFeaturesPassed: true,
    binarySha256,
  });
  put(`${base}/reports/${target}/software/result.json`, {
    results: [{ passed: true }],
    binarySha256,
  });
  const archives = windows
    ? [`${buildId}.zip`]
    : [`${buildId}-runtime.tar.xz`, `${buildId}-sources.tar.xz`];
  for (const archive of archives)
    put(`${base}/releases/${target}/${buildId}/${archive}`, 'release archive');
  put(
    `${base}/releases/${target}/${buildId}/${windows ? `${buildId}.zip.sha256` : 'SHA256SUMS.txt'}`,
    archives.map((archive) => `${hash('release archive')}  ${archive}\n`).join('')
  );
  const selection = put(`${base}/state/${target}/selected.json`, {
    buildId,
    directory: 'C:/previous-runner/candidate',
    runtime: `${buildId}/runtime`,
    sourceArchive: `${buildId}-sources.tar.xz`,
    runtimeArchive: `${buildId}-runtime.tar.xz`,
  });
  return { root, put, target, selection, candidate, buildId };
}

test('verified compiled caches support all targets and rebase Windows selection safely', async (t) => {
  for (const target of ['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']) {
    const f = fixture(t, target);
    await verifyCompiledCache(f.root, target, { save: true });
    await verifyCompiledCache(f.root, target);
    if (target === 'win32-x64')
      assert.equal(
        JSON.parse(readFileSync(f.selection, 'utf8')).directory,
        path.join(f.root, f.candidate)
      );
  }
});

test('cache verification rejects changed binary bytes, source archives and recipe inputs', async (t) => {
  for (const change of ['binary', 'source', 'recipe', 'missing-archive']) {
    const f = fixture(t, 'linux-x64');
    await verifyCompiledCache(f.root, f.target, { save: true });
    if (change === 'binary') f.put('build/ffmpeg/install/linux-x64/bin/ffmpeg', 'tampered');
    if (change === 'source')
      f.put(
        `build/ffmpeg/candidates/linux-x64/${f.buildId}/source/sources/ffmpeg.tar.xz`,
        'tampered'
      );
    if (change === 'recipe') f.put('tooling/ffmpeg/recipe.txt', 'changed');
    if (change === 'missing-archive')
      f.put(
        `build/ffmpeg/releases/linux-x64/${f.buildId}/SHA256SUMS.txt`,
        `${hash('release archive')}  ${f.buildId}-sources.tar.xz\n`
      );
    await assert.rejects(
      verifyCompiledCache(f.root, f.target),
      /checksum mismatch|does not match|do not match|incomplete/
    );
  }
});

test('cache keys isolate CPU targets and macOS toolchain images without rebuilding for unrelated UI edits', (t) => {
  const f = fixture(t, 'linux-x64');
  assert.notEqual(
    compiledCacheKey(f.root, 'linux-x64').key,
    compiledCacheKey(f.root, 'linux-arm64').key
  );
  assert.notEqual(
    compiledCacheKey(f.root, 'darwin-x64', { ImageVersion: 'A' }).key,
    compiledCacheKey(f.root, 'darwin-x64', { ImageVersion: 'B' }).key
  );
  assert.notEqual(
    compiledCacheKey(f.root, 'darwin-arm64', { ImageVersion: 'A' }).key,
    compiledCacheKey(f.root, 'darwin-arm64', { ImageVersion: 'B' }).key
  );
  assert.notEqual(
    compiledCacheKey(f.root, 'darwin-x64').key,
    compiledCacheKey(f.root, 'darwin-arm64').key
  );
  const before = compiledCacheKey(f.root, 'win32-x64').key;
  f.put('public/unrelated-ui.html', 'new UI');
  assert.equal(compiledCacheKey(f.root, 'win32-x64').key, before);
  f.put(windowsCommandFiles[0], 'changed FFmpeg command arguments');
  assert.notEqual(compiledCacheKey(f.root, 'win32-x64').key, before);
});
