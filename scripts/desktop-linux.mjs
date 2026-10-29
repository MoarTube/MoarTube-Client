import { desktopPaths, ffmpegPaths } from '../tooling/build-paths.cjs';
import { parseLinuxTarget } from '../tooling/ffmpeg/scripts/linux-target.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const { arch, target, dockerPlatform } = parseLinuxTarget(process.argv.slice(2));
const layout = desktopPaths(root, target, version);
const ffmpeg = ffmpegPaths(root, target);
if (!existsSync(ffmpeg.selection))
  throw new Error(
    `Compile FFmpeg first: npm run ffmpeg:build:linux${arch === 'arm64' ? ':arm64' : ''}`
  );
const selected = JSON.parse(readFileSync(ffmpeg.selection, 'utf8'));
if (
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(selected.buildId) ||
  selected.sourceArchive !== `${selected.buildId}-sources.tar.xz`
)
  throw new Error('Invalid Linux FFmpeg candidate');
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
const image = `moartube-desktop-builder-${arch}:ubuntu24`;
docker(['build', '--platform', dockerPlatform, '-t', image, 'desktop/linux']);
const name = `moartube-desktop-build-${arch}-${process.pid}`;
const envArgs = process.env.MOARTUBE_RELEASE_TAG
  ? ['-e', `MOARTUBE_RELEASE_TAG=${process.env.MOARTUBE_RELEASE_TAG}`]
  : [];
docker([
  'create',
  '--platform',
  dockerPlatform,
  '--name',
  name,
  ...envArgs,
  '-e',
  'CSC_IDENTITY_AUTO_DISCOVERY=false',
  '-e',
  `MOARTUBE_DESKTOP_ARCH=${arch}`,
  image,
  'node',
  'scripts/desktop-linux-container.mjs',
]);
try {
  for (const item of [
    'src',
    'public',
    'bin',
    'desktop',
    'scripts',
    'tooling',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsup.config.ts',
    'LICENSE.md',
    'README.md',
  ])
    docker(['cp', path.join(root, item), `${name}:/workspace/${item}`]);
  for (const category of ['candidates', 'releases', 'state']) {
    const source = path.join(
      ffmpeg.base,
      category,
      target,
      ...(category === 'state' ? [] : [selected.buildId])
    );
    const destination = `/workspace/build/ffmpeg/${category}/${target}${category === 'state' ? '' : '/' + selected.buildId}`;
    docker([
      'cp',
      category === 'state' ? `${source}${path.sep}.` : source,
      `${name}:${destination}`,
    ]);
  }
  docker(['start', '-a', name], { allowFailure: true });
  const code = docker(['inspect', name, '--format', '{{.State.ExitCode}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  if (code !== '0') throw new Error(`Linux desktop build failed; container retained: ${name}`);
  const output = layout.release;
  mkdirSync(output, { recursive: true });
  docker(['cp', `${name}:/workspace/build/desktop/releases/${target}/${version}/.`, output]);
  mkdirSync(layout.reports, { recursive: true });
  docker(['cp', `${name}:/workspace/build/desktop/reports/${target}/.`, layout.reports]);
  const engineArchitecture = docker(['info', '--format', '{{.Architecture}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  const imageId = docker(['image', 'inspect', image, '--format', '{{.Id}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  const execution = (arch === 'arm64' ? ['arm64', 'aarch64'] : ['amd64', 'x86_64']).includes(
    engineArchitecture
  )
    ? 'native-container'
    : 'emulated-container';
  writeFileSync(
    path.join(layout.reports, 'build.json'),
    JSON.stringify(
      {
        target,
        version,
        dockerPlatform,
        engineArchitecture,
        execution,
        imageId,
        ffmpegBuildId: selected.buildId,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    ) + '\n'
  );
  docker(['rm', name]);
  console.log(`Linux desktop artifacts: ${output}`);
} catch (error) {
  console.error(`Build container retained for diagnostics: ${name}`);
  throw error;
}
