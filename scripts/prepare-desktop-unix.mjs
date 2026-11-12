import { desktopPaths, ffmpegPaths } from '../tooling/build-paths.cjs';
import { parseDarwinTarget } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
import { linuxTarget } from '../tooling/ffmpeg/scripts/linux-target.mjs';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  cpSync,
  copyFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDarwinReleaseNotes } from './lib/darwin-release-notes.mjs';
import { writeLinuxReleaseNotes } from './lib/linux-release-notes.mjs';
import { sha256 } from './lib/desktop-ffmpeg.mjs';

const darwin = process.platform === 'darwin';
const { arch, target } = darwin
  ? parseDarwinTarget(process.argv.slice(2))
  : linuxTarget(process.env.MOARTUBE_DESKTOP_ARCH ?? process.arch);
if ((!darwin && process.platform !== 'linux') || process.arch !== arch)
  throw new Error('Run desktop preparation on matching native macOS or Linux x64/ARM64.');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const layout = desktopPaths(root, target, version);
const ffmpeg = ffmpegPaths(root, target);
if (!existsSync(ffmpeg.selection))
  throw new Error(
    `Compile FFmpeg first: npm run ffmpeg:build:${darwin ? `darwin${arch === 'arm64' ? ':arm64' : ''}` : arch === 'arm64' ? 'linux:arm64' : 'linux'}`
  );
const selection = JSON.parse(readFileSync(ffmpeg.selection, 'utf8'));
const artifacts = path.join(ffmpeg.releases, selection.buildId);
if (
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(selection.buildId) ||
  selection.runtime !== `${selection.buildId}/runtime` ||
  selection.sourceArchive !== `${selection.buildId}-sources.tar.xz`
)
  throw new Error('Invalid FFmpeg selection; compile the matching target first');
const candidate = path.join(ffmpeg.candidates, selection.runtime);
const manifest = JSON.parse(readFileSync(path.join(candidate, 'manifest.json'), 'utf8'));
if (
  manifest.schemaVersion !== 1 ||
  manifest.target !== target ||
  manifest.buildId !== selection.buildId ||
  manifest.qualification.compiledFeatures !== 'passed'
)
  throw new Error('Unverified FFmpeg candidate');
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = manifest.files?.[name];
  if (
    file?.path !== `${manifest.buildId}/${name}` ||
    sha256(path.join(candidate, file.path)) !== file.sha256
  )
    throw new Error(`FFmpeg ${name} checksum mismatch`);
}
const expected = readFileSync(path.join(artifacts, 'SHA256SUMS.txt'), 'utf8')
  .split(/\r?\n/)
  .find((line) => line.endsWith(`  ${selection.sourceArchive}`))
  ?.split('  ')[0];
const sourceSha256 = sha256(path.join(artifacts, selection.sourceArchive));
if (!expected || sourceSha256 !== expected)
  throw new Error('FFmpeg source archive checksum mismatch');
execFileSync(process.execPath, [path.join(root, 'scripts/desktop-icon.mjs')], { stdio: 'inherit' });
const output = layout.release;
mkdirSync(output, { recursive: true });
mkdirSync(layout.reports, { recursive: true });
mkdirSync(layout.state, { recursive: true });
const runtimeDirectory = path.join(layout.staging, selection.buildId, 'runtime');
cpSync(candidate, runtimeDirectory, { recursive: true });
for (const name of ['ffmpeg', 'ffprobe'])
  chmodSync(path.join(runtimeDirectory, manifest.files[name].path), 0o755);
copyFileSync(
  path.join(artifacts, selection.sourceArchive),
  path.join(output, selection.sourceArchive)
);

const releaseTag = process.env.MOARTUBE_RELEASE_TAG || `v${version}`;
const releaseBase = `https://github.com/MoarTube/MoarTube-Client/releases/download/${encodeURIComponent(releaseTag)}`;
const sourceUrl = `${releaseBase}/${selection.sourceArchive}`;
writeFileSync(
  path.join(runtimeDirectory, 'SOURCES.txt'),
  `MoarTube FFmpeg build ${manifest.buildId}\nGPL-enabled FFmpeg including libx264. License texts: licenses/.\n\n` +
    `Corresponding sources, dependency sources, and build recipe:\n${sourceUrl}\nSHA256: ${sourceSha256}\n\n` +
    'Sources are a separate optional download from the same GitHub Release as the application.\n'
);
writeFileSync(
  layout.selection,
  JSON.stringify(
    {
      runtimeDirectory,
      nodeVersion: process.version,
      buildId: manifest.buildId,
      sourceArchive: selection.sourceArchive,
      sourceSha256,
      sourceUrl,
      releaseTag,
    },
    null,
    2
  ) + '\n'
);
if (darwin) {
  writeDarwinReleaseNotes({ output, version, target, releaseBase, sourceUrl });
} else {
  writeLinuxReleaseNotes({ output, version, target, releaseBase, sourceUrl });
}

console.log(
  `Desktop bundles FFmpeg ${manifest.buildId}; separate sources: ${selection.sourceArchive}`
);
