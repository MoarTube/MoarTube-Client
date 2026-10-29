import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [platform] = process.argv.slice(2);
if (!['windows', 'linux', 'darwin'].includes(platform) || process.argv.length !== 3)
  throw new Error('Usage: check-download-cache.mjs <windows|linux|darwin>');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const lock = JSON.parse(readFileSync(path.join(root, 'tooling/ffmpeg/sources.lock.json'), 'utf8'));
const ids = new Set([
  'ffmpeg',
  'x264',
  'libvpx',
  'opus',
  'dav1d',
  'zlib',
  ...(platform === 'linux' ? ['nv-codec-headers'] : []),
]);
const entries = lock.sources
  .filter((source) => platform === 'windows' || ids.has(source.id))
  .map((source) => ({ source, directory: 'sources' }));
if (platform === 'windows') {
  const tools = JSON.parse(
    readFileSync(path.join(root, 'tooling/ffmpeg/toolchain.lock.json'), 'utf8')
  );
  entries.push(
    ...[tools.bootstrap, ...tools.packages].map((source) => ({
      source,
      directory: 'toolchains/win32-x64',
    }))
  );
}
let complete = true;
for (const { source, directory } of entries) {
  const file = path.join(root, 'build/ffmpeg/cache', directory, source.archive);
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== source.sha256) throw new Error('checksum mismatch');
  } catch (error) {
    console.log(
      `Not saving incomplete download cache: ${source.archive}: ${error.code ?? error.message}`
    );
    complete = false;
    break;
  }
}
console.log(`Verified download cache complete: ${complete} (${platform})`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `complete=${complete}\n`);
