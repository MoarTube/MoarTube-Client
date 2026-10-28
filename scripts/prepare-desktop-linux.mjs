import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib/desktop-ffmpeg.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error(
    'Run Linux desktop preparation on Linux x64 (or use desktop:dist:linux from Windows).'
  );
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(root, 'build/ffmpeg/artifacts/linux-x64');
const selection = JSON.parse(readFileSync(path.join(artifacts, 'selected.json'), 'utf8'));
if (
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(selection.buildId) ||
  selection.runtime !== `${selection.buildId}/runtime` ||
  selection.sourceArchive !== `${selection.buildId}-sources.tar.xz`
)
  throw new Error('Invalid Linux FFmpeg selection; run npm run ffmpeg:build:linux first');
const candidate = path.join(artifacts, selection.runtime);
const manifest = JSON.parse(readFileSync(path.join(candidate, 'manifest.json'), 'utf8'));
if (
  manifest.schemaVersion !== 1 ||
  manifest.target !== 'linux-x64' ||
  manifest.buildId !== selection.buildId ||
  manifest.qualification.compiledFeatures !== 'passed'
)
  throw new Error('Unverified Linux FFmpeg candidate');
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = manifest.files?.[name];
  if (
    file?.path !== `${manifest.buildId}/${name}` ||
    sha256(path.join(candidate, file.path)) !== file.sha256
  )
    throw new Error(`Linux FFmpeg ${name} checksum mismatch`);
}
const expected = readFileSync(path.join(artifacts, 'SHA256SUMS.txt'), 'utf8')
  .split(/\r?\n/)
  .find((line) => line.endsWith(`  ${selection.sourceArchive}`))
  ?.split('  ')[0];
const sourceSha256 = sha256(path.join(artifacts, selection.sourceArchive));
if (!expected || sourceSha256 !== expected)
  throw new Error('Linux FFmpeg source archive checksum mismatch');
execFileSync(process.execPath, [path.join(root, 'scripts/desktop-icon.mjs')], { stdio: 'inherit' });
const output = path.join(root, 'build/desktop/output/linux');
mkdirSync(output, { recursive: true });
const runtimeDirectory = path.join(
  mkdtempSync(path.join(root, 'build/desktop/ffmpeg-release-')),
  'runtime'
);
cpSync(candidate, runtimeDirectory, { recursive: true });
for (const name of ['ffmpeg', 'ffprobe'])
  chmodSync(path.join(runtimeDirectory, manifest.files[name].path), 0o755);
copyFileSync(
  path.join(artifacts, selection.sourceArchive),
  path.join(output, selection.sourceArchive)
);
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const releaseTag = process.env.MOARTUBE_RELEASE_TAG ?? `v${version}`;
const releaseBase = `https://github.com/MoarTube/MoarTube-Client/releases/download/${encodeURIComponent(releaseTag)}`;
const sourceUrl = `${releaseBase}/${selection.sourceArchive}`;
writeFileSync(
  path.join(runtimeDirectory, 'SOURCES.txt'),
  `MoarTube FFmpeg build ${manifest.buildId}\nGPL-enabled FFmpeg including libx264. License texts: licenses/.\n\n` +
    `Corresponding sources, dependency sources, and build recipe:\n${sourceUrl}\nSHA256: ${sourceSha256}\n\n` +
    'Sources are a separate optional download from the same GitHub Release as the application.\n'
);
writeFileSync(
  path.join(root, 'build/desktop/ffmpeg-selection-linux.json'),
  JSON.stringify(
    {
      runtimeDirectory,
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
writeFileSync(
  path.join(output, 'RELEASE-NOTES-linux-x64.md'),
  `# MoarTube Client ${version} - Ubuntu 24.04 and 26.04 x64\n\n` +
    `- [Ubuntu installer](${releaseBase}/MoarTube-Client-${version}-linux-x64.deb)\n` +
    `- [Standalone archive](${releaseBase}/MoarTube-Client-${version}-linux-x64.tar.gz)\n` +
    `- [FFmpeg corresponding sources](${sourceUrl}) - optional\n` +
    `- [Checksums](${releaseBase}/SHA256SUMS-linux-x64.txt)\n\n` +
    'Install the DEB with sudo apt install ./MoarTube-Client-<version>-linux-x64.deb so system dependencies are resolved. Node.js, FFmpeg and FFprobe are bundled. GPU drivers are host prerequisites. Connect to your existing MoarTube Node.\n\n' +
    'The standalone archive requires the documented desktop/FFmpeg libraries and a working Chromium sandbox. Use the DEB for Ubuntu integration. Sources remain separate; publish and retain the linked archive beside the app.\n\n' +
    `Publish using tag ${releaseTag}. Native GPU, Wayland and full Node-connected desktop qualification remain release work; see docs/electron-linux.md.\n`
);
console.log(
  `Linux desktop bundles FFmpeg ${manifest.buildId}; separate sources: ${selection.sourceArchive}`
);
