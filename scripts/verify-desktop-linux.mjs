import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLinuxDesktopArgs, linuxVariant, linuxPaths } from '../desktop/linux-variant.cjs';
import { verifyLinuxCoexist } from './verify-desktop-linux-coexist.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const { arch, target, dockerPlatform, variants } = parseLinuxDesktopArgs(process.argv.slice(2));
const docker = (args, options = {}) => {
  const { allowFailure = false, ...spawnOptions } = options;
  const result = spawnSync('docker', args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...spawnOptions,
  });
  if (result.error || (result.status !== 0 && !allowFailure))
    throw result.error ?? new Error('docker ' + args[0] + ' failed (' + result.status + ')');
  return result;
};
const engineArchitecture = docker(['info', '--format', '{{.Architecture}}'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
}).stdout.trim();
if (!(arch === 'arm64' ? ['arm64', 'aarch64'] : ['amd64', 'x86_64']).includes(engineArchitecture))
  throw new Error(
    target +
      ' graphical verification requires a matching native Docker engine. Use the ARM64 full-system VM verifier on x64.'
  );
const images = JSON.parse(
  readFileSync(path.join(root, 'tooling/ffmpeg/platforms/linux/runtime-images.json'), 'utf8')
);
if (arch === 'arm64')
  Object.assign(
    images,
    JSON.parse(readFileSync(path.join(root, 'desktop/linux/arm64-runtime-images.json'), 'utf8'))
  );
for (const variant of variants) {
  const selected = linuxVariant(variant);
  const layout = linuxPaths(root, arch, version, variant);
  const results = [];
  for (const [ubuntu, image] of Object.entries(images)) {
    const tag = 'moartube-desktop-runtime-' + arch + ':' + ubuntu;
    if (process.env.MOARTUBE_DEPENDENCIES_PREPARED === '1')
      docker(['image', 'inspect', tag], { stdio: 'ignore' });
    else
      docker([
        'build',
        '--platform',
        dockerPlatform,
        '-f',
        'desktop/linux/runtime.Dockerfile',
        '--build-arg',
        'UBUNTU_IMAGE=' + image,
        '-t',
        tag,
        'desktop/linux',
      ]);
    const name = 'moartube-desktop-qa-' + arch + '-' + variant + '-' + ubuntu + '-' + process.pid;
    docker([
      'create',
      '--init',
      '--platform',
      dockerPlatform,
      '--cap-add',
      'SYS_ADMIN',
      '--name',
      name,
      ...(process.env.MOARTUBE_DEPENDENCIES_PREPARED === '1' ? ['--network', 'none'] : []),
      '-e',
      'MOARTUBE_DESKTOP_ARCH=' + arch,
      '-e',
      'MOARTUBE_DESKTOP_VARIANT=' + variant,
      tag,
      'bash',
      'scripts/linux-installed-smoke.sh',
    ]);
    for (const suffix of ['.deb', '-portable.tar.gz']) {
      const asset = selected.prefix + '-' + version + '-' + target + suffix;
      docker(['cp', path.join(layout.release, asset), name + ':/workspace/' + asset]);
    }
    for (const directory of ['tooling', 'desktop', 'scripts'])
      docker([
        'cp',
        path.join(root, directory) + path.sep + '.',
        name + ':/workspace/' + directory,
      ]);
    docker(['start', '-a', name], { allowFailure: true });
    const code = docker(['inspect', name, '--format', '{{.State.ExitCode}}'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    }).stdout.trim();
    const reports = path.join(layout.reports, ubuntu);
    const profiles = path.join(layout.profiles, 'qa-' + variant + '-' + ubuntu);
    mkdirSync(reports, { recursive: true });
    mkdirSync(profiles, { recursive: true });
    docker(['cp', name + ':/workspace/build/desktop/reports/' + target + '/.', reports]);
    docker(['cp', name + ':/workspace/build/desktop/profiles/' + target + '/.', profiles]);
    results.push({
      variant,
      target,
      runtime: ubuntu,
      baseImage: image,
      passed: code === '0',
      exitCode: code,
      container: code === '0' ? undefined : name,
    });
    if (code === '0') docker(['rm', name]);
    else console.error('Failed graphical check; container retained: ' + name);
  }
  mkdirSync(layout.reports, { recursive: true });
  writeFileSync(
    path.join(layout.reports, 'verification.json'),
    JSON.stringify(
      {
        target,
        variant,
        engineArchitecture,
        execution: 'native-container',
        checkedAt: new Date().toISOString(),
        results,
      },
      null,
      2
    ) + '\n'
  );
  if (results.some((result) => !result.passed))
    throw new Error(target + ' ' + variant + ': installed/portable checks failed.');
}
if (variants.length > 1)
  verifyLinuxCoexist({ root, arch, version, image: 'moartube-desktop-runtime-' + arch + ':24.04' });
