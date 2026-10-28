import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// Keep the complete verified candidate intact. Only the desktop runtime copy is
// reduced; the separate source tree retains the rebuild recipe and evidence.
export function stageDesktopFfmpeg(candidate, runtimeDirectory, sourceDirectory) {
  const manifest = JSON.parse(readFileSync(path.join(candidate, 'manifest.json'), 'utf8'));
  if (
    typeof manifest.buildId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.buildId) ||
    manifest.schemaVersion !== 1 ||
    manifest.target !== 'win32-x64'
  )
    throw new Error('Invalid Windows FFmpeg candidate');
  for (const name of ['ffmpeg', 'ffprobe']) {
    const file = manifest.files?.[name];
    if (
      file?.path !== `${manifest.buildId}/${name}.exe` ||
      sha256(path.join(candidate, file.path)) !== file.sha256
    )
      throw new Error(`FFmpeg candidate ${name} checksum mismatch`);
  }
  const lock = JSON.parse(
    readFileSync(path.join(candidate, 'recipe/tooling/ffmpeg/sources.lock.json'), 'utf8')
  );
  if (!lock.sources?.length) throw new Error('FFmpeg source lock is empty');
  for (const source of lock.sources) {
    if (
      path.basename(source.archive) !== source.archive ||
      sha256(path.join(candidate, 'sources', source.archive)) !== source.sha256
    )
      throw new Error(`FFmpeg source checksum mismatch: ${source.id}`);
  }
  mkdirSync(runtimeDirectory, { recursive: true });
  mkdirSync(sourceDirectory, { recursive: true });
  for (const name of [manifest.buildId, 'licenses', 'manifest.json', 'provenance.json'])
    cpSync(path.join(candidate, name), path.join(runtimeDirectory, name), { recursive: true });
  for (const name of [
    'sources',
    'recipe',
    'licenses',
    'client-command-snapshot',
    'reports',
    'BUILD.txt',
    'NOTICES.txt',
    'manifest.json',
    'provenance.json',
  ])
    cpSync(path.join(candidate, name), path.join(sourceDirectory, name), { recursive: true });
  // The full candidate's notice refers to directories omitted from the runtime.
  const notice = readFileSync(path.join(candidate, 'NOTICES.txt'), 'utf8').replace(
    'See licenses/, sources/ and recipe/.',
    'See licenses/ and SOURCES.txt. Corresponding sources and recipe are a separate release download.'
  );
  writeFileSync(path.join(runtimeDirectory, 'NOTICES.txt'), notice);
  writeFileSync(
    path.join(sourceDirectory, 'README.txt'),
    `Corresponding sources for MoarTube FFmpeg build ${manifest.buildId}.\n` +
      'This archive intentionally excludes compiled executables. manifest.json records the matching binary SHA-256 hashes.\n' +
      'See BUILD.txt for rebuilding, sources/ for the pinned upstream archives, recipe/ for patches and build scripts, and licenses/ for license texts.\n'
  );
  return manifest;
}
