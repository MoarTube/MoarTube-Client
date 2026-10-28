import { linuxTarget } from './linux-target.mjs';
import { ffmpegPaths } from '../../build-paths.cjs';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, writeFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { arch, target } = linuxTarget(process.env.MOARTUBE_FFMPEG_ARCH ?? process.arch);
const layout = ffmpegPaths(root, target);
const build = layout.base;
const work = layout.work;
const osRelease = readFileSync('/etc/os-release', 'utf8');
if (
  process.platform !== 'linux' ||
  process.arch !== arch ||
  !/^VERSION_ID="24\.04"$/m.test(osRelease)
)
  throw new Error(
    'Build inside the pinned Ubuntu 24.04 compiler image matching the target architecture.'
  );
const lock = JSON.parse(readFileSync(path.join(root, 'tooling/ffmpeg/sources.lock.json'), 'utf8'));
const ids = new Set(['ffmpeg', 'x264', 'libvpx', 'opus', 'dav1d', 'zlib', 'nv-codec-headers']);
const sources = lock.sources.filter((source) => ids.has(source.id));
for (const source of sources) {
  const archive = path.join(build, 'cache/sources', source.archive);
  const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (hash !== source.sha256) throw new Error(`Source checksum mismatch: ${source.id}`);
  const destination = path.join(work, 'sources', source.id);
  const marker = path.join(destination, '.moartube-source-sha256');
  if (existsSync(marker)) {
    if (readFileSync(marker, 'utf8') !== hash)
      throw new Error('Use a fresh Linux build workspace after changing sources.');
  } else {
    mkdirSync(destination, { recursive: true });
    execFileSync('tar', ['-xf', archive, '-C', destination, '--strip-components=1'], {
      stdio: 'inherit',
    });
    writeFileSync(marker, hash);
  }
}
// The Windows Direct3D/AMF and MinGW patches do not apply to the Linux build.
const report = layout.reports;
mkdirSync(report, { recursive: true });
writeFileSync(
  path.join(report, 'sources.lock.json'),
  JSON.stringify({ ...lock, target, sources, patches: [] }, null, 2) + '\n'
);
writeFileSync(path.join(report, 'os-release.txt'), osRelease);
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
run('bash', ['tooling/ffmpeg/platforms/linux/build.sh', root]);
const bin = path.join(layout.install, 'bin');
run(process.execPath, [
  'tooling/ffmpeg/scripts/verify-features.mjs',
  `${bin}/ffmpeg`,
  `${bin}/ffprobe`,
  report,
  target,
]);
run(process.execPath, ['tooling/ffmpeg/scripts/inspect-linux.mjs']);
run(process.execPath, [
  'tooling/ffmpeg/scripts/verify-software.mjs',
  `${bin}/ffmpeg`,
  `${bin}/ffprobe`,
  `${report}/software`,
]);
cpSync(path.join(root, 'tooling'), path.join(build, 'linux-recipe/tooling'), { recursive: true });
run(process.execPath, ['tooling/ffmpeg/scripts/package-linux.mjs']);
console.log(
  `${target} build and CPU checks passed (${process.env.MOARTUBE_BUILD_EXECUTION ?? 'container'}). Native GPU qualification remains pending.`
);
