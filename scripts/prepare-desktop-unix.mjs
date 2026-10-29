import { desktopPaths, ffmpegPaths } from '../tooling/build-paths.cjs';
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
import { sha256 } from './lib/desktop-ffmpeg.mjs';

const darwin = process.platform === 'darwin';
const { arch, target } = darwin
  ? { arch: 'x64', target: 'darwin-x64' }
  : linuxTarget(process.env.MOARTUBE_DESKTOP_ARCH ?? process.arch);
if ((!darwin && process.platform !== 'linux') || process.arch !== arch)
  throw new Error('Run desktop preparation on matching native macOS x64 or Linux x64/ARM64.');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const layout = desktopPaths(root, target, version);
const ffmpeg = ffmpegPaths(root, target);
if (!existsSync(ffmpeg.selection))
  throw new Error(
    `Compile FFmpeg first: npm run ffmpeg:build:${darwin ? 'darwin' : arch === 'arm64' ? 'linux:arm64' : 'linux'}`
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
mkdirSync(layout.state, { recursive: true });
const runtimeDirectory = path.join(layout.staging, selection.buildId, 'runtime');
const nodeRuntimeDirectory = path.join(layout.staging, `node-${arch}-${process.version}`);
const nodeLicense =
  process.env.MOARTUBE_NODE_LICENSE ?? path.resolve(path.dirname(process.execPath), '../LICENSE');
if (!existsSync(nodeLicense))
  throw new Error(
    'Node runtime LICENSE missing; set MOARTUBE_NODE_LICENSE to the matching Node distribution LICENSE.'
  );
mkdirSync(nodeRuntimeDirectory, { recursive: true });
copyFileSync(process.execPath, path.join(nodeRuntimeDirectory, 'node'));
chmodSync(path.join(nodeRuntimeDirectory, 'node'), 0o755);
copyFileSync(nodeLicense, path.join(nodeRuntimeDirectory, 'LICENSE'));
writeFileSync(
  path.join(nodeRuntimeDirectory, 'NOTICES.txt'),
  `Node.js ${process.version} (${arch}), bundled for the desktop backend. See LICENSE for Node.js and third-party license texts.\n`
);
cpSync(candidate, runtimeDirectory, { recursive: true });
for (const name of ['ffmpeg', 'ffprobe'])
  chmodSync(path.join(runtimeDirectory, manifest.files[name].path), 0o755);
copyFileSync(
  path.join(artifacts, selection.sourceArchive),
  path.join(output, selection.sourceArchive)
);

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
  layout.selection,
  JSON.stringify(
    {
      runtimeDirectory,
      nodeRuntimeDirectory,
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
  writeFileSync(
    path.join(output, `RELEASE-NOTES-${target}.md`),
    `# MoarTube Client ${version} - macOS 15+ Intel x64\n\n` +
      `- [Disk image](${releaseBase}/MoarTube-Client-${version}-${target}.dmg)\n` +
      `- [Application ZIP](${releaseBase}/MoarTube-Client-${version}-${target}.zip)\n` +
      `- [FFmpeg corresponding sources](${sourceUrl}) - optional\n` +
      `- [Checksums](${releaseBase}/SHA256SUMS-${target}.txt)\n\n` +
      'Ad-hoc signed, not notarized. macOS may block browser downloads; see docs/electron-darwin.md for manual approval. Node.js, FFmpeg and FFprobe are bundled. Connect to an existing MoarTube Node. Publish and retain matching FFmpeg sources beside the app. Hardware VideoToolbox and physical Mac qualification remain pending.\n'
  );
} else {
  writeFileSync(
    path.join(output, `RELEASE-NOTES-${target}.md`),
    `# MoarTube Client ${version} - Ubuntu 24.04 and 26.04 ${arch}\n\n` +
      `- [Ubuntu installer](${releaseBase}/MoarTube-Client-${version}-${target}.deb)\n` +
      `- [Standalone archive](${releaseBase}/MoarTube-Client-${version}-${target}.tar.gz)\n` +
      `- [FFmpeg corresponding sources](${sourceUrl}) - optional\n` +
      `- [Checksums](${releaseBase}/SHA256SUMS-${target}.txt)\n\n` +
      `Install the DEB with sudo apt install ./MoarTube-Client-<version>-${target}.deb so system dependencies are resolved. Node.js, FFmpeg and FFprobe are bundled. GPU drivers are host prerequisites. Connect to your existing MoarTube Node.\n\n` +
      'The standalone archive requires the documented desktop/FFmpeg libraries and a working Chromium sandbox. Use the DEB for Ubuntu integration. Sources remain separate; publish and retain the linked archive beside the app.\n\n' +
      `Publish using tag ${releaseTag}. Native GPU, Wayland and full Node-connected desktop qualification remain release work; see docs/electron-linux.md.\n`
  );
}

console.log(
  `Desktop bundles FFmpeg ${manifest.buildId}; separate sources: ${selection.sourceArchive}`
);
