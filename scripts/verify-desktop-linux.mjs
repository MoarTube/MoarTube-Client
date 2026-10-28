import { desktopPaths } from '../tooling/build-paths.cjs';
import { parseLinuxTarget } from '../tooling/ffmpeg/scripts/linux-target.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const { arch, target, dockerPlatform } = parseLinuxTarget(process.argv.slice(2));
const layout = desktopPaths(root, target, version);

const output = layout.release;
const deb = `MoarTube-Client-${version}-${target}.deb`;
if (!existsSync(path.join(output, deb))) throw new Error('Run npm run desktop:dist:linux first');
const images = JSON.parse(
  readFileSync(path.join(root, 'tooling/ffmpeg/platforms/linux/runtime-images.json'), 'utf8')
);
if (arch === 'arm64')
  Object.assign(
    images,
    JSON.parse(readFileSync(path.join(root, 'desktop/linux/arm64-runtime-images.json'), 'utf8'))
  );
const docker = (args, options = {}) => {
  const { allowFailure = false, ...spawnOptions } = options;
  const result = spawnSync('docker', args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...spawnOptions,
  });
  if (result.error || (result.status !== 0 && !allowFailure))
    throw result.error ?? new Error(`docker ${args[0]} failed (${result.status})`);
  return result;
};
const engineArchitecture = docker(['info', '--format', '{{.Architecture}}'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
}).stdout.trim();
const execution = (arch === 'arm64' ? ['arm64', 'aarch64'] : ['amd64', 'x86_64']).includes(
  engineArchitecture
)
  ? 'native-container'
  : 'emulated-container';
const results = [];
for (const [ubuntu, image] of Object.entries(images)) {
  const distro = ubuntu === 'debian-trixie' ? 'Debian Trixie' : `Ubuntu ${ubuntu}`;
  const reportName = ubuntu === 'debian-trixie' ? ubuntu : `ubuntu-${ubuntu}`;
  const tag = `moartube-desktop-runtime-${arch}:${ubuntu}`;
  docker([
    'build',
    '--platform',
    dockerPlatform,
    '-f',
    'desktop/linux/runtime.Dockerfile',
    '--build-arg',
    `UBUNTU_IMAGE=${image}`,
    '-t',
    tag,
    'desktop/linux',
  ]);
  const name = `moartube-desktop-qa-${arch}-${ubuntu}-${process.pid}`;
  // Chromium's sandbox needs namespace syscalls inside this test container.
  // SYS_ADMIN is limited to the disposable container; sandbox flags stay enabled.
  docker([
    'create',
    '--platform',
    dockerPlatform,
    '--cap-add',
    'SYS_ADMIN',
    '--name',
    name,
    '-e',
    `MOARTUBE_DESKTOP_ARCH=${arch}`,
    tag,
    'bash',
    'scripts/linux-installed-smoke.sh',
  ]);
  docker(['cp', path.join(output, deb), `${name}:/workspace/${deb}`]);
  const archive = `MoarTube-Client-${version}-${target}.tar.gz`;
  docker(['cp', path.join(output, archive), `${name}:/workspace/${archive}`]);
  docker(['cp', path.join(root, 'tooling'), `${name}:/workspace/tooling`]);
  for (const item of ['desktop-smoke.mjs', 'linux-installed-smoke.sh', 'linux-backend-probe.cjs'])
    docker(['cp', path.join(root, 'scripts', item), `${name}:/workspace/scripts/${item}`]);
  docker(['start', '-a', name], { allowFailure: true });
  const code = docker(['inspect', name, '--format', '{{.State.ExitCode}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  const reports = path.join(layout.reports, reportName);
  const profiles = path.join(layout.profiles, reportName);
  mkdirSync(profiles, { recursive: true });
  mkdirSync(reports, { recursive: true });
  docker(['cp', `${name}:/workspace/build/desktop/reports/${target}/.`, reports]);
  docker(['cp', `${name}:/workspace/build/desktop/profiles/${target}/.`, profiles]);
  results.push({
    distribution: distro,
    runtime: ubuntu,
    baseImage: image,
    target,
    execution,
    passed: code === '0',
    exitCode: code,
    container: code === '0' ? undefined : name,
  });
  if (code !== '0') console.error(`${distro} desktop checks failed; container retained: ${name}`);
  else {
    docker(['rm', name]);
    console.log(`${distro}: installed app checks passed`);
  }
}
mkdirSync(layout.reports, { recursive: true });
writeFileSync(
  path.join(layout.reports, 'verification.json'),
  JSON.stringify(
    { target, engineArchitecture, execution, checkedAt: new Date().toISOString(), results },
    null,
    2
  ) + '\n'
);
if (results.some((result) => !result.passed))
  throw new Error(
    `${target}: desktop checks failed; see per-distro reports and retained containers.`
  );
