import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, writeFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const build = path.join(root, 'build/ffmpeg');
const work = path.join(build, 'work/linux-x64');
const osRelease = readFileSync('/etc/os-release', 'utf8');
if (
  process.platform !== 'linux' ||
  process.arch !== 'x64' ||
  !/^VERSION_ID="24\.04"$/m.test(osRelease)
)
  throw new Error('Build inside the pinned Ubuntu 24.04 x64 compiler image.');
const lock = JSON.parse(readFileSync(path.join(root, 'tooling/ffmpeg/sources.lock.json'), 'utf8'));
const ids = new Set(['ffmpeg', 'x264', 'libvpx', 'opus', 'dav1d', 'zlib', 'nv-codec-headers']);
const sources = lock.sources.filter((source) => ids.has(source.id));
for (const source of sources) {
  const archive = path.join(build, 'cache', source.archive);
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
const report = path.join(build, 'reports/linux-x64');
mkdirSync(report, { recursive: true });
writeFileSync(
  path.join(report, 'sources.lock.json'),
  JSON.stringify({ ...lock, target: 'linux-x64', sources, patches: [] }, null, 2) + '\n'
);
writeFileSync(path.join(report, 'os-release.txt'), osRelease);
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
run('bash', ['tooling/ffmpeg/platforms/linux/build.sh', root]);
const bin = path.join(build, 'install/linux-x64/bin');
run(process.execPath, [
  'tooling/ffmpeg/scripts/verify-features.mjs',
  `${bin}/ffmpeg`,
  `${bin}/ffprobe`,
  report,
  'linux-x64',
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
  'Linux x64 build and CPU checks passed. Native Linux GPU qualification remains pending.'
);
