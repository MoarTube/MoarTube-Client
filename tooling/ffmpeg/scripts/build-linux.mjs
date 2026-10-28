import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  readFileSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const build = path.join(root, 'build/ffmpeg');
const cache = path.join(build, 'cache');
const image = 'moartube-ffmpeg-linux-x64:ubuntu24';
const run = (args, options = {}) => {
  const result = spawnSync('docker', args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`docker ${args[0]} failed (${result.status})`);
  return result;
};
const hash = async (file) => {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(file)) value.update(chunk);
  return value.digest('hex');
};
mkdirSync(cache, { recursive: true });
const lock = JSON.parse(readFileSync(path.join(root, 'tooling/ffmpeg/sources.lock.json'), 'utf8'));
const ids = new Set(['ffmpeg', 'x264', 'libvpx', 'opus', 'dav1d', 'zlib', 'nv-codec-headers']);
for (const source of lock.sources.filter((entry) => ids.has(entry.id))) {
  const file = path.join(cache, source.archive);
  if (!existsSync(file)) {
    console.log(`Fetching ${source.archive}`);
    const response = await fetch(source.url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw new Error(`Download failed: ${source.url}`);
    const temporary = `${file}.linux-partial`;
    await pipeline(response.body, createWriteStream(temporary));
    if ((await hash(temporary)) !== source.sha256)
      throw new Error(`Downloaded source checksum mismatch: ${source.id}`);
    renameSync(temporary, file);
  }
  if ((await hash(file)) !== source.sha256)
    throw new Error(`Cached source checksum mismatch: ${source.id}`);
}
run(['build', '--platform', 'linux/amd64', '-t', image, 'tooling/ffmpeg/platforms/linux']);
const identity = run(['image', 'inspect', image, '--format', '{{.Id}}'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
}).stdout.trim();
mkdirSync(path.join(build, 'reports/linux-x64'), { recursive: true });
writeFileSync(path.join(build, 'reports/linux-x64/compiler-image.txt'), identity + '\n');
const name = `moartube-ffmpeg-build-${process.pid}`;
const workspaceKey = createHash('sha256')
  .update(JSON.stringify(lock))
  .update(readFileSync(path.join(root, 'tooling/ffmpeg/platforms/linux/build.sh')))
  .update(identity)
  .digest('hex')
  .slice(0, 16);
run([
  'create',
  '--platform',
  'linux/amd64',
  '--name',
  name,
  '--mount',
  `type=bind,source=${cache},target=/inputs,readonly`,
  '--mount',
  `type=volume,source=moartube-ffmpeg-linux-${workspaceKey},target=/workspace/build/ffmpeg/work/linux-x64`,
  '-e',
  `MOARTUBE_BUILD_JOBS=${process.env.MOARTUBE_BUILD_JOBS ?? '8'}`,
  image,
  'bash',
  '-lc',
  'mkdir -p build/ffmpeg && ln -s /inputs build/ffmpeg/cache && node tooling/ffmpeg/scripts/build-linux-native.mjs',
]);
// Copy only build tooling. Compilation stays on the Linux filesystem, not NTFS.
let success = false;
try {
  run(['cp', path.join(root, 'tooling'), `${name}:/workspace/tooling`]);
  run(['cp', path.join(root, 'LICENSE.md'), `${name}:/workspace/LICENSE.md`]);
  run(['start', '-a', name]);
  const exitCode = run(['inspect', name, '--format', '{{.State.ExitCode}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  run([
    'cp',
    `${name}:/workspace/build/ffmpeg/reports/linux-x64/.`,
    path.join(build, 'reports/linux-x64'),
  ]);
  if (exitCode !== '0')
    throw new Error(`Linux build failed (${exitCode}); see reports and retained container ${name}`);
  mkdirSync(path.join(build, 'install/linux-x64'), { recursive: true });
  run([
    'cp',
    `${name}:/workspace/build/ffmpeg/install/linux-x64/.`,
    path.join(build, 'install/linux-x64'),
  ]);
  mkdirSync(path.join(build, 'artifacts/linux-x64'), { recursive: true });
  run([
    'cp',
    `${name}:/workspace/build/ffmpeg/artifacts/linux-x64/.`,
    path.join(build, 'artifacts/linux-x64'),
  ]);
  success = true;
  run(['rm', name]);
  console.log(`Linux FFmpeg and FFprobe: ${path.join(build, 'install/linux-x64/bin')}`);
} finally {
  if (!success) console.error(`Build container retained for diagnostics: ${name}`);
}
