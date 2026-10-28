import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const linux = process.argv.includes('--linux');
const directory = path.resolve(
  fileURLToPath(
    new URL(linux ? '../build/desktop/output/linux/' : '../build/desktop/output/', import.meta.url)
  )
);
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;
const selection = JSON.parse(
  readFileSync(
    new URL(
      linux
        ? '../build/desktop/ffmpeg-selection-linux.json'
        : '../build/desktop/ffmpeg-selection.json',
      import.meta.url
    ),
    'utf8'
  )
);
const artifacts = [
  ...(linux
    ? [`MoarTube-Client-${version}-linux-x64.deb`, `MoarTube-Client-${version}-linux-x64.tar.gz`]
    : [
        `MoarTube-Client-${version}-windows-x64-setup.exe`,
        `MoarTube-Client-${version}-windows-x64.zip`,
      ]),
  selection.sourceArchive,
].sort();
const lines = [];
for (const name of artifacts) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
  const digest = hash.digest('hex');
  if (name === selection.sourceArchive && digest !== selection.sourceSha256)
    throw new Error('FFmpeg source archive changed after desktop preparation');
  lines.push(`${digest}  ${name}`);
}
const checksumFile = linux ? 'SHA256SUMS-linux-x64.txt' : 'SHA256SUMS.txt';
writeFileSync(path.join(directory, checksumFile), lines.join('\n') + '\n');
console.log(`Desktop artifact checksums: ${path.join(directory, checksumFile)}`);
