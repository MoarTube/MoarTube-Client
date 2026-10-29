import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ffmpegPaths } from '../../build-paths.cjs';
import { downloadArchive } from './download-archive.mjs';

const [target] = process.argv.slice(2);
if (process.argv.length !== 3) throw new Error('Usage: download-inputs.mjs <target>');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const layout = ffmpegPaths(root, target);
const lock = JSON.parse(readFileSync(path.join(root, 'tooling/ffmpeg/sources.lock.json'), 'utf8'));
const ids = new Set([
  'ffmpeg',
  'x264',
  'libvpx',
  'opus',
  'dav1d',
  'zlib',
  ...(target.startsWith('linux') ? ['nv-codec-headers'] : []),
]);
for (const source of lock.sources.filter((source) => target === 'win32-x64' || ids.has(source.id)))
  await downloadArchive(source, layout.sources, { offline: false });
if (target === 'win32-x64') {
  const tools = JSON.parse(
    readFileSync(path.join(root, 'tooling/ffmpeg/toolchain.lock.json'), 'utf8')
  );
  for (const source of [tools.bootstrap, ...tools.packages])
    await downloadArchive(source, layout.toolchainDownloads, { offline: false });
}
console.log(`All ${target} source/toolchain downloads verified before compilation.`);
