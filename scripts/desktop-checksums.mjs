import { desktopPaths } from '../tooling/build-paths.cjs';
import { windowsPaths, windowsVariant } from '../desktop/windows-variant.cjs';
import { parseDarwinTarget } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
import { parseLinuxDesktopArgs, linuxVariant, linuxPaths } from '../desktop/linux-variant.cjs';
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const linux = process.argv.includes('--linux');
const darwin = process.argv.includes('--darwin');
if (darwin && linux)
  throw new Error('Usage: desktop-checksums.mjs --darwin [--arch=x64|--arch=arm64]');
const target = darwin
  ? parseDarwinTarget(process.argv.slice(2).filter((arg) => arg !== '--darwin')).target
  : linux
    ? parseLinuxDesktopArgs(
        process.argv.slice(2).filter((arg) => arg !== '--linux'),
        'client'
      ).target
    : 'win32-x64';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;
const windowsMode =
  process.argv.find((arg) => arg.startsWith('--windows-variant='))?.split('=')[1] ?? 'bundled';
const selectedWindows = !linux && !darwin ? windowsVariant(windowsMode) : undefined;
const selectedLinux = linux
  ? linuxVariant(
      parseLinuxDesktopArgs(
        process.argv.slice(2).filter((arg) => arg !== '--linux'),
        'client'
      ).variant
    )
  : undefined;
const layout = selectedLinux
  ? linuxPaths(root, target.slice(6), version, selectedLinux.name)
  : selectedWindows
    ? windowsPaths(root, version, selectedWindows.name)
    : desktopPaths(root, target, version);
const directory = layout.release;
mkdirSync(directory, { recursive: true });
const selection = JSON.parse(readFileSync(layout.selection, 'utf8'));
const nodeSource = selectedWindows?.bundled
  ? JSON.parse(readFileSync(path.join(layout.state, 'node-source.json'), 'utf8'))
  : undefined;
const nodeSourcePrefix = `MoarTube-Client-Node-${version}-windows-x64-`;
if (
  nodeSource &&
  (nodeSource.clientVersion !== version ||
    nodeSource.releaseTag !== selection.releaseTag ||
    typeof nodeSource.archive !== 'string' ||
    !nodeSource.archive.startsWith(nodeSourcePrefix) ||
    !/^[a-f0-9]{12}-sources\.zip$/.test(nodeSource.archive.slice(nodeSourcePrefix.length)))
)
  throw new Error('Client + Node source archive does not match this release.');
const artifacts = [
  ...(darwin
    ? [`MoarTube-Client-${version}-${target}.dmg`, `MoarTube-Client-${version}-${target}.zip`]
    : linux
      ? [
          `${selectedLinux.prefix}-${version}-${target}.deb`,
          `${selectedLinux.prefix}-${version}-${target}-portable.tar.gz`,
        ]
      : [
          `${selectedWindows.prefix}-${version}-windows-x64-setup.exe`,
          `${selectedWindows.prefix}-${version}-windows-x64-portable.zip`,
        ]),
  selection.sourceArchive,
  ...(nodeSource ? [nodeSource.archive] : []),
].sort();
const lines = [];
for (const name of artifacts) {
  const packed = path.join(layout.packages, name);
  if (existsSync(packed)) renameSync(packed, path.join(directory, name));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
  const digest = hash.digest('hex');
  if (name === selection.sourceArchive && digest !== selection.sourceSha256)
    throw new Error('FFmpeg source archive changed after desktop preparation');
  if (name === nodeSource?.archive && digest !== nodeSource.sha256)
    throw new Error('Client + Node source archive changed after desktop preparation');
  lines.push(`${digest}  ${name}`);
}
if (selectedWindows) {
  writeFileSync(
    path.join(directory, `SHA256SUMS-windows-${selectedWindows.name}.txt`),
    lines.slice().sort().join('\n') + '\n'
  );
}
// Include the other variant only when this build explicitly produced both.
// A single-variant build must not publish a stale binary from an earlier build.
if (selectedWindows && process.argv.includes('--all-windows-variants')) {
  for (const other of ['client', 'bundled'].filter((value) => value !== selectedWindows.name)) {
    for (const suffix of ['-setup.exe', '-portable.zip']) {
      const name = `${windowsVariant(other).prefix}-${version}-windows-x64${suffix}`;
      const file = path.join(directory, name);
      if (existsSync(file)) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        lines.push(`${hash.digest('hex')}  ${name}`);
      }
    }
  }
}
if (selectedWindows) {
  // Remove maps from prior builds of this version. ZIP-based NSIS packages have no block map.
  const blockmap = `${selectedWindows.prefix}-${version}-windows-x64-setup.exe.blockmap`;
  rmSync(path.join(layout.packages, blockmap), { force: true });
  rmSync(path.join(directory, blockmap), { force: true });
}
if (selectedLinux)
  writeFileSync(
    path.join(directory, `SHA256SUMS-${target}-${selectedLinux.name}.txt`),
    lines.slice().sort().join('\n') + '\n'
  );
const checksumFile = selectedLinux?.bundled
  ? `SHA256SUMS-${target}-bundled.txt`
  : linux || darwin
    ? `SHA256SUMS-${target}.txt`
    : 'SHA256SUMS.txt';
writeFileSync(path.join(directory, checksumFile), lines.sort().join('\n') + '\n');
console.log(`Desktop artifact checksums: ${path.join(directory, checksumFile)}`);
