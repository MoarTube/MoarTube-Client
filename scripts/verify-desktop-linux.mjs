import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const output = path.join(root, 'build/desktop/output/linux');
const deb = `MoarTube-Client-${version}-linux-x64.deb`;
if (!existsSync(path.join(output, deb))) throw new Error('Run npm run desktop:dist:linux first');
const images = JSON.parse(
  readFileSync(path.join(root, 'tooling/ffmpeg/platforms/linux/runtime-images.json'), 'utf8')
);
const docker = (args, options = {}) => {
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
for (const [ubuntu, image] of Object.entries(images)) {
  const tag = `moartube-desktop-runtime:${ubuntu}`;
  docker([
    'build',
    '--platform',
    'linux/amd64',
    '-f',
    'desktop/linux/runtime.Dockerfile',
    '--build-arg',
    `UBUNTU_IMAGE=${image}`,
    '-t',
    tag,
    'desktop/linux',
  ]);
  const name = `moartube-desktop-qa-${ubuntu}-${process.pid}`;
  // Chromium's sandbox needs namespace syscalls inside this test container.
  // SYS_ADMIN is limited to the disposable container; sandbox flags stay enabled.
  docker([
    'create',
    '--platform',
    'linux/amd64',
    '--cap-add',
    'SYS_ADMIN',
    '--name',
    name,
    tag,
    'bash',
    'scripts/linux-installed-smoke.sh',
  ]);
  docker(['cp', path.join(output, deb), `${name}:/workspace/${deb}`]);
  const archive = `MoarTube-Client-${version}-linux-x64.tar.gz`;
  docker(['cp', path.join(output, archive), `${name}:/workspace/${archive}`]);
  for (const item of ['desktop-smoke.mjs', 'linux-installed-smoke.sh'])
    docker(['cp', path.join(root, 'scripts', item), `${name}:/workspace/scripts/${item}`]);
  docker(['start', '-a', name]);
  const code = docker(['inspect', name, '--format', '{{.State.ExitCode}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  const reports = path.join(root, 'build/desktop', `linux-ubuntu-${ubuntu}`);
  mkdirSync(reports, { recursive: true });
  docker(['cp', `${name}:/workspace/build/desktop/.`, reports]);
  if (code !== '0')
    throw new Error(`Ubuntu ${ubuntu} desktop checks failed; container retained: ${name}`);
  docker(['rm', name]);
  console.log(`Ubuntu ${ubuntu}: installed app checks passed`);
}
