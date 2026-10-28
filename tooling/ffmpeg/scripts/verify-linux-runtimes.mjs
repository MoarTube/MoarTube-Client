import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
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
const results = [];
for (const [version, image] of Object.entries(images)) {
  const tag = `moartube-ffmpeg-runtime:${version}`;
  docker([
    'build',
    '--platform',
    'linux/amd64',
    '-t',
    tag,
    '-f',
    'tooling/ffmpeg/platforms/linux/runtime.Dockerfile',
    '--build-arg',
    `UBUNTU_IMAGE=${image}`,
    'tooling/ffmpeg/platforms/linux',
  ]);
  const name = `moartube-ffmpeg-runtime-${version}-${process.pid}`;
  docker([
    'create',
    '--platform',
    'linux/amd64',
    '--name',
    name,
    tag,
    'bash',
    '-lc',
    'chmod +x build/ffmpeg/install/linux-x64/bin/ffmpeg build/ffmpeg/install/linux-x64/bin/ffprobe && node tooling/ffmpeg/scripts/verify-features.mjs build/ffmpeg/install/linux-x64/bin/ffmpeg build/ffmpeg/install/linux-x64/bin/ffprobe /reports/features linux-x64 && node tooling/ffmpeg/scripts/verify-software.mjs build/ffmpeg/install/linux-x64/bin/ffmpeg build/ffmpeg/install/linux-x64/bin/ffprobe /reports/software',
  ]);
  docker(['cp', path.join(root, 'tooling'), `${name}:/workspace/tooling`]);
  docker([
    'cp',
    path.join(root, 'build/ffmpeg/install/linux-x64'),
    `${name}:/workspace/build/ffmpeg/install/linux-x64`,
  ]);
  docker(['start', '-a', name]);
  const exitCode = docker(['inspect', name, '--format', '{{.State.ExitCode}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  const report = path.join(root, 'build/ffmpeg/reports/linux-x64', `ubuntu-${version}`);
  mkdirSync(report, { recursive: true });
  docker(['cp', `${name}:/reports/.`, report]);
  docker(['cp', `${name}:/runtime-packages.txt`, path.join(report, 'runtime-packages.txt')]);
  if (exitCode !== '0')
    throw new Error(`Ubuntu ${version} runtime failed; container retained: ${name}`);
  results.push({
    ubuntu: version,
    baseImage: image,
    passed: true,
    scope: 'container CPU/software and compiled-feature checks; no native GPU qualification',
  });
  docker(['rm', name]);
}
writeFileSync(
  path.join(root, 'build/ffmpeg/reports/linux-x64/runtimes.json'),
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n'
);
console.log('Ubuntu 24.04 and 26.04 runtime checks passed. Native GPU tests remain pending.');
