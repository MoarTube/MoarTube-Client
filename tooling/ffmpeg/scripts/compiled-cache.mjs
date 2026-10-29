import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegPaths } from '../../build-paths.cjs';
import { recipeHash } from './recipe-hash.mjs';

const sha256 = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function compiledCacheKey(root, target, environment = process.env) {
  ffmpegPaths(root, target);
  const recipe = recipeHash(root, target);
  const identity = createHash('sha256')
    .update(
      JSON.stringify({
        target,
        recipe,
        node: process.version,
        image: target.startsWith('darwin-')
          ? (environment.ImageVersion ?? environment.ImageOS ?? 'native-macos')
          : 'locked-toolchain',
      })
    )
    .digest('hex');
  return { key: `ffmpeg-compiled-v1-${target}-${identity}`, recipe };
}

export async function verifyCompiledCache(root, target, { save = false } = {}) {
  const layout = ffmpegPaths(root, target);
  const current = compiledCacheKey(root, target);
  const selection = read(layout.selection);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(selection.buildId))
    throw new Error('Invalid cached FFmpeg build ID');
  const windows = target === 'win32-x64';
  if (
    !windows &&
    (selection.runtime !== `${selection.buildId}/runtime` ||
      selection.sourceArchive !== `${selection.buildId}-sources.tar.xz` ||
      selection.runtimeArchive !== `${selection.buildId}-runtime.tar.xz`)
  )
    throw new Error('Cached FFmpeg selection does not match its build ID');
  const candidate = path.join(
    layout.candidates,
    selection.buildId,
    ...(windows ? [] : ['runtime'])
  );
  const manifest = read(path.join(candidate, 'manifest.json'));
  const provenance = read(path.join(candidate, 'provenance.json'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.target !== target ||
    manifest.buildId !== selection.buildId ||
    provenance.recipeSha256 !== current.recipe ||
    manifest.qualification?.compiledFeatures !== 'passed' ||
    manifest.qualification?.softwareSmoke !== 'passed'
  )
    throw new Error(
      'Cached FFmpeg target, recipe or qualification does not match current build inputs'
    );
  const metadata = path.join(layout.state, 'compiled-cache.json');
  if (!save && read(metadata).key !== current.key)
    throw new Error('Compiled FFmpeg cache key does not match this build');
  const features = read(
    path.join(layout.reports, target.startsWith('darwin-') ? 'features.json' : 'result.json')
  );
  const software = read(path.join(layout.reports, 'software/result.json'));
  if (
    !(features.compiledFeaturesPassed || features.passed) ||
    !software.results?.length ||
    software.results.some((entry) => !entry.passed)
  )
    throw new Error('Cached FFmpeg verification evidence is incomplete');
  for (const name of ['ffmpeg', 'ffprobe']) {
    const extension = windows ? '.exe' : '';
    const entry = manifest.files[name];
    if (entry.path !== `${selection.buildId}/${name}${extension}`)
      throw new Error('Invalid cached binary path');
    for (const file of [
      path.join(candidate, entry.path),
      path.join(layout.install, 'bin', name + extension),
    ])
      if ((await sha256(file)) !== entry.sha256)
        throw new Error(`Cached ${name} binary checksum mismatch`);
    if (
      features.binarySha256[name] !== entry.sha256 ||
      software.binarySha256[name] !== entry.sha256
    )
      throw new Error('Cached evidence does not identify the cached binaries');
  }
  const sourceRoot = windows
    ? path.join(candidate, 'sources')
    : path.join(layout.candidates, selection.buildId, 'source/sources');
  const ids = new Set([
    'ffmpeg',
    'x264',
    'libvpx',
    'opus',
    'dav1d',
    'zlib',
    ...(target.startsWith('linux') ? ['nv-codec-headers'] : []),
  ]);
  const sources = read(path.join(root, 'tooling/ffmpeg/sources.lock.json')).sources.filter(
    (entry) => windows || ids.has(entry.id)
  );
  for (const source of sources)
    if ((await sha256(path.join(sourceRoot, source.archive))) !== source.sha256)
      throw new Error(`Cached source checksum mismatch: ${source.id}`);
  const release = path.join(layout.releases, selection.buildId);
  const checksumFile = windows ? `${selection.buildId}.zip.sha256` : 'SHA256SUMS.txt';
  const expectedArchives = new Set(
    windows
      ? [`${selection.buildId}.zip`]
      : [`${selection.buildId}-runtime.tar.xz`, `${selection.buildId}-sources.tar.xz`]
  );
  for (const line of readFileSync(path.join(release, checksumFile), 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._+-]+)$/.exec(line);
    if (
      !match ||
      !expectedArchives.delete(match[2]) ||
      (await sha256(path.join(release, match[2]))) !== match[1]
    )
      throw new Error('Cached FFmpeg release archive checksum mismatch');
  }
  if (expectedArchives.size) throw new Error('Cached FFmpeg release archives are incomplete');
  // Selection paths may have originated in another runner checkout directory.
  if (windows)
    writeFileSync(
      layout.selection,
      JSON.stringify({ ...selection, directory: candidate }, null, 2) + '\n'
    );
  if (save) writeFileSync(metadata, JSON.stringify({ target, ...current }, null, 2) + '\n');
  return current;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, target] = process.argv.slice(2);
  if (!['key', 'verify', 'save'].includes(mode) || process.argv.length !== 4)
    throw new Error('Usage: compiled-cache.mjs <key|verify|save> <target>');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result =
    mode === 'key'
      ? compiledCacheKey(root, target)
      : await verifyCompiledCache(root, target, { save: mode === 'save' });
  console.log(`${mode}: ${result.key}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `key=${result.key}\n`);
}
