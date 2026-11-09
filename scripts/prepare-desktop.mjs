import { desktopPaths, ffmpegPaths } from '../tooling/build-paths.cjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageDesktopFfmpeg, sha256 } from './lib/desktop-ffmpeg.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const variant = process.argv.find(arg => arg.startsWith('--variant='))?.split('=')[1] ?? 'all';
if (!['all', 'client', 'bundled'].includes(variant)) throw new Error('Invalid Windows desktop variant');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const layout = desktopPaths(root, 'win32-x64', version);
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Desktop packaging currently supports native Windows x64.');
execFileSync(process.execPath, [path.join(root, 'scripts/desktop-icon.mjs')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
// The FFmpeg packager verifies binary-bound feature/software/dependency evidence
// and includes the complete sources, patches and redistribution materials.
execFileSync(
  process.execPath,
  [path.join(root, 'tooling/ffmpeg/scripts/package-windows.mjs'), '--reuse'],
  { cwd: root, stdio: 'inherit', windowsHide: true }
);
const ffmpeg = ffmpegPaths(root, 'win32-x64');
const selection = JSON.parse(readFileSync(ffmpeg.selection, 'utf8'));
const directory = path.resolve(selection.directory);
const allowed = ffmpeg.candidates + path.sep;
if (!directory.startsWith(allowed))
  throw new Error('FFmpeg candidate is outside the build artifact directory');
mkdirSync(layout.staging, { recursive: true });
mkdirSync(layout.state, { recursive: true });
const staging = path.join(layout.staging, selection.buildId);
const runtimeDirectory = path.join(staging, 'runtime');
const sourceDirectory = path.join(staging, 'source');
const manifest = stageDesktopFfmpeg(directory, runtimeDirectory, sourceDirectory);
if (manifest.buildId !== selection.buildId) throw new Error('FFmpeg selection build ID mismatch');

const releaseTag = process.env.MOARTUBE_RELEASE_TAG || `v${version}`;
const sourceArchive = `MoarTube-FFmpeg-${manifest.buildId}${variant === 'all' ? '' : `-${variant}`}-sources.zip`;
const checksumName = variant === 'all' ? 'SHA256SUMS.txt' : `SHA256SUMS-windows-${variant}.txt`;
const notesName = variant === 'all' ? 'RELEASE-NOTES.md' : `RELEASE-NOTES-windows-${variant}.md`;
const releaseBase = `https://github.com/MoarTube/MoarTube-Client/releases/download/${encodeURIComponent(releaseTag)}`;
const sourceUrl = `${releaseBase}/${sourceArchive}`;
const output = layout.release;
mkdirSync(output, { recursive: true });
const partial = path.join(output, `${sourceArchive}.partial-${process.pid}.zip`);
execFileSync('tar.exe', ['-a', '-cf', partial, '-C', sourceDirectory, '.'], {
  windowsHide: true,
  stdio: 'inherit',
});
renameSync(partial, path.join(output, sourceArchive));
const sourceSha256 = sha256(path.join(output, sourceArchive));
writeFileSync(
  path.join(runtimeDirectory, 'SOURCES.txt'),
  `Corresponding sources for FFmpeg build ${manifest.buildId}\n\n` +
    'This application includes GPL-enabled FFmpeg and libx264. License texts are in licenses/.\n' +
    `Download the separate source archive from the same GitHub Release as this application:\n${sourceUrl}\n\n` +
    `Archive: ${sourceArchive}\nSHA256: ${sourceSha256}\n\n` +
    'It includes matching upstream dependency sources, the AMD patch, build recipes and license materials.\n' +
    'The app runs using the bundled binaries; downloading sources is optional.\n'
);
const installer = `MoarTube-Client-${version}-windows-x64-setup.exe`;
const portable = `MoarTube-Client-${version}-windows-x64-portable.zip`;
const bundledInstaller = `MoarTube-Client-Node-${version}-windows-x64-setup.exe`;
const bundledPortable = `MoarTube-Client-Node-${version}-windows-x64-portable.zip`;
writeFileSync(
  path.join(output, notesName),
  `# MoarTube Client ${version} — Windows 11 x64\n\n` +
    (variant !== 'bundled' ? `- [Client installer](${releaseBase}/${installer})\n- [Client ZIP](${releaseBase}/${portable})\n` : '') +
    (variant !== 'client' ? `- [Client + Node installer](${releaseBase}/${bundledInstaller})\n- [Client + Node ZIP](${releaseBase}/${bundledPortable})\n` : '') +
    `- [FFmpeg corresponding sources](${sourceUrl}) — optional; build ${manifest.buildId}.\n` +
    `- [SHA-256 checksums](${releaseBase}/${checksumName})\n\n` +
    'Client: sign into a Node you run separately; closing the window quits the Client. Client + Node: includes Node.js and Cloudflared, uses automatic sign-in by default (configure credentials in Settings to require sign-in on next start), connects only to its owned Node, and closes to the tray. Choose Quit MoarTube to stop both backends. Both variants include FFmpeg and FFprobe, have separate data folders, and can be installed together.\n\n' +
    'This candidate is unsigned; Windows may display an unknown-publisher/SmartScreen warning.\n\n' +
    'FFmpeg is GPL-enabled, including libx264. The source download includes the corresponding upstream sources, dependency sources, patches, build instructions and license texts. Sources are not required to run the app.\n\n' +
    `Release checklist: publish at tag \`${releaseTag}\`, upload the selected variant downloads, checksums, notes and matching FFmpeg sources, and retain the matching source archive for as long as the binaries remain available. Validate installation, upgrades and Node-connected workflows before declaring a stable release.\n`
);
if (variant === 'all') {
  const notes = readFileSync(path.join(output, notesName), 'utf8');
  for (const selected of ['client', 'bundled']) {
    const omitted = selected === 'client' ? [bundledInstaller, bundledPortable] : [installer, portable];
    const variantNotes = notes.split('\n').filter(line => !omitted.some(file => line.includes(`/${file})`)))
      .join('\n').replaceAll('SHA256SUMS.txt', `SHA256SUMS-windows-${selected}.txt`);
    writeFileSync(path.join(output, `RELEASE-NOTES-windows-${selected}.md`), variantNotes);
  }
}
writeFileSync(
  layout.selection,
  JSON.stringify(
    {
      directory,
      runtimeDirectory,
      buildId: selection.buildId,
      sourceArchive,
      sourceSha256,
      sourceUrl,
      releaseTag,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `Windows desktop will bundle FFmpeg binaries ${selection.buildId}. Separate source download: ${sourceArchive}`
);
