import { parseLinuxTarget } from './linux-target.mjs';
import { ffmpegPaths } from '../../build-paths.cjs';
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
const { arch, target, dockerPlatform } = parseLinuxTarget(process.argv.slice(2));
const layout = ffmpegPaths(root, target);
const build = layout.base;
const cache = path.join(build, 'cache/sources');
const image = `moartube-ffmpeg-${target}:ubuntu24`;
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
run(['build', '--platform', dockerPlatform, '-t', image, 'tooling/ffmpeg/platforms/linux']);
const identity = run(['image', 'inspect', image, '--format', '{{.Id}}'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
}).stdout.trim();
mkdirSync(layout.reports, { recursive: true });
writeFileSync(path.join(layout.reports, 'compiler-image.txt'), identity + '\n');
const engineArch = run(['info', '--format', '{{.Architecture}}'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
}).stdout.trim();
const execution = (arch === 'arm64' ? ['aarch64', 'arm64'] : ['x86_64', 'amd64']).includes(
  engineArch
)
  ? 'native-container'
  : 'emulated-container';
const name = `moartube-ffmpeg-${arch}-build-${process.pid}`;
const workspaceKey = createHash('sha256')
  .update(JSON.stringify(lock))
  .update(readFileSync(path.join(root, 'tooling/ffmpeg/platforms/linux/build.sh')))
  .update(identity)
  .digest('hex')
  .slice(0, 16);
run([
  'create',
  '--platform',
  dockerPlatform,
  '--name',
  name,
  '--mount',
  `type=bind,source=${cache},target=/inputs,readonly`,
  '--mount',
  `type=volume,source=moartube-ffmpeg-linux-${workspaceKey},target=/workspace/build/ffmpeg/work/${target}`,
  '-e',
  `MOARTUBE_BUILD_JOBS=${process.env.MOARTUBE_BUILD_JOBS ?? '8'}`,
  '-e',
  `MOARTUBE_FFMPEG_ARCH=${arch}`,
  '-e',
  `MOARTUBE_BUILD_EXECUTION=${execution}`,
  '-e',
  `MOARTUBE_BUILD_ENGINE_ARCH=${engineArch}`,
  image,
  'bash',
  '-lc',
  'mkdir -p build/ffmpeg/cache && ln -s /inputs build/ffmpeg/cache/sources && node tooling/ffmpeg/scripts/build-linux-native.mjs',
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
  run(['cp', `${name}:/workspace/build/ffmpeg/reports/${target}/.`, layout.reports]);
  if (exitCode !== '0')
    throw new Error(`Linux build failed (${exitCode}); see reports and retained container ${name}`);
  mkdirSync(layout.install, { recursive: true });
  run(['cp', `${name}:/workspace/build/ffmpeg/install/${target}/.`, layout.install]);
  for (const category of ['candidates', 'releases', 'state']) {
    const destination = path.join(build, category, target);
    mkdirSync(destination, { recursive: true });
    run(['cp', `${name}:/workspace/build/ffmpeg/${category}/${target}/.`, destination]);
  }
  success = true;
  run(['rm', name]);
  console.log(`Linux FFmpeg and FFprobe: ${path.join(layout.install, 'bin')}`);
} finally {
  if (!success) console.error(`Build container retained for diagnostics: ${name}`);
}
