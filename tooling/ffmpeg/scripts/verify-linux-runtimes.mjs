import { parseLinuxTarget } from './linux-target.mjs';
import { ffmpegPaths } from '../../build-paths.cjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const { arch, target, dockerPlatform } = parseLinuxTarget(process.argv.slice(2));
const layout = ffmpegPaths(root, target);
const images = JSON.parse(
  readFileSync(new URL('../platforms/linux/runtime-images.json', import.meta.url), 'utf8')
);
function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`Runtime check failed: docker ${args[0]} (${result.status})`);
  return result;
}
const engineArchitecture = docker(['info', '--format', '{{.Architecture}}'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
}).stdout.trim();
const execution = (arch === 'arm64' ? ['aarch64', 'arm64'] : ['x86_64', 'amd64']).includes(
  engineArchitecture
)
  ? 'native-container'
  : 'emulated-container';
const binarySha256 = Object.fromEntries(
  ['ffmpeg', 'ffprobe'].map((name) => [
    name,
    createHash('sha256')
      .update(readFileSync(path.join(layout.install, 'bin', name)))
      .digest('hex'),
  ])
);
const results = [];
for (const [version, image] of Object.entries(images)) {
  const tag = `moartube-ffmpeg-runtime-${arch}:${version}`;
  docker([
    'build',
    '--platform',
    dockerPlatform,
    '-t',
    tag,
    '-f',
    'tooling/ffmpeg/platforms/linux/runtime.Dockerfile',
    '--build-arg',
    `UBUNTU_IMAGE=${image}`,
    'tooling/ffmpeg/platforms/linux',
  ]);
  const name = `moartube-ffmpeg-runtime-${arch}-${version}-${process.pid}`;
  docker([
    'create',
    '--platform',
    dockerPlatform,
    '--name',
    name,
    tag,
    'node',
    'tooling/ffmpeg/scripts/verify-linux-runtime-native.mjs',
    `--arch=${arch}`,
  ]);
  docker(['cp', path.join(root, 'tooling'), `${name}:/workspace/tooling`]);
  docker(['cp', layout.install, `${name}:/workspace/build/ffmpeg/install/${target}`]);
  docker(['start', '-a', name]);
  const exitCode = docker(['inspect', name, '--format', '{{.State.ExitCode}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  const report = path.join(layout.reports, `ubuntu-${version}`);
  mkdirSync(report, { recursive: true });
  docker(['cp', `${name}:/reports/.`, report]);
  docker(['cp', `${name}:/runtime-packages.txt`, path.join(report, 'runtime-packages.txt')]);
  if (exitCode !== '0')
    throw new Error(`Ubuntu ${version} runtime failed; container retained: ${name}`);
  results.push({
    ubuntu: version,
    target,
    dockerPlatform,
    execution,
    baseImage: image,
    passed: true,
    scope: 'container CPU/software and compiled-feature checks; no native GPU qualification',
  });
  docker(['rm', name]);
}
writeFileSync(
  path.join(layout.reports, 'runtimes.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      target,
      engineArchitecture,
      execution,
      binarySha256,
      results,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `${target}: Ubuntu 24.04 and 26.04 runtime checks passed. Native GPU tests remain pending.`
);
