import { desktopPaths } from '../tooling/build-paths.cjs';
import { parseLinuxTarget } from '../tooling/ffmpeg/scripts/linux-target.mjs';
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const linux = process.argv.includes('--linux');
const target = linux
  ? parseLinuxTarget(process.argv.slice(2).filter((arg) => arg !== '--linux')).target
  : 'win32-x64';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;
const layout = desktopPaths(root, target, version);
const directory = layout.release;
mkdirSync(directory, { recursive: true });
const selection = JSON.parse(readFileSync(layout.selection, 'utf8'));
const artifacts = [
  ...(linux
    ? [`MoarTube-Client-${version}-${target}.deb`, `MoarTube-Client-${version}-${target}.tar.gz`]
    : [
        `MoarTube-Client-${version}-windows-x64-setup.exe`,
        `MoarTube-Client-${version}-windows-x64.zip`,
      ]),
  selection.sourceArchive,
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
  lines.push(`${digest}  ${name}`);
}
const blockmap = `MoarTube-Client-${version}-windows-x64-setup.exe.blockmap`;
if (!linux && existsSync(path.join(layout.packages, blockmap)))
  renameSync(path.join(layout.packages, blockmap), path.join(directory, blockmap));
const checksumFile = linux ? `SHA256SUMS-${target}.txt` : 'SHA256SUMS.txt';
writeFileSync(path.join(directory, checksumFile), lines.join('\n') + '\n');
console.log(`Desktop artifact checksums: ${path.join(directory, checksumFile)}`);
