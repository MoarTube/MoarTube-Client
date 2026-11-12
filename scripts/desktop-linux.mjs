import { desktopPaths, ffmpegPaths } from '../tooling/build-paths.cjs';
import { parseLinuxDesktopArgs } from '../desktop/linux-variant.cjs';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  statSync,
  cpSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const { arch, target, dockerPlatform, variant, variants, dir } = parseLinuxDesktopArgs(
  process.argv.slice(2)
);
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
const prepared = process.env.MOARTUBE_DEPENDENCIES_PREPARED === '1';
let image = `moartube-desktop-${prepared ? 'dependencies' : 'builder'}-${arch}:ubuntu24`;
if (prepared) docker(['image', 'inspect', image], { stdio: 'ignore' });
else docker(['build', '--platform', dockerPlatform, '-t', image, 'desktop/linux']);
if (variants.includes('bundled')) {
  if (!prepared) {
    const result = spawnSync(
      process.execPath,
      ['scripts/prepare-linux-node-dependencies.mjs', '--arch=' + arch],
      { cwd: root, stdio: 'inherit', windowsHide: true }
    );
    if (result.error || result.status !== 0)
      throw result.error ?? new Error('Node dependency preparation failed');
  }
  image = `moartube-desktop-node-dependencies-${arch}:ubuntu24`;
  docker(['image', 'inspect', image], { stdio: 'ignore' });
}
const name = `moartube-desktop-build-${arch}-${variant}-${process.pid}`;
const envArgs = process.env.MOARTUBE_RELEASE_TAG
  ? ['-e', `MOARTUBE_RELEASE_TAG=${process.env.MOARTUBE_RELEASE_TAG}`]
  : [];
const engineArchitecture = docker(['info', '--format', '{{.Architecture}}'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
}).stdout.trim();
docker([
  'create',
  '--platform',
  dockerPlatform,
  '--name',
  name,
  ...(prepared ? ['--network', 'none'] : []),
  ...envArgs,
  '-e',
  'CSC_IDENTITY_AUTO_DISCOVERY=false',
  '-e',
  `MOARTUBE_DESKTOP_ARCH=${arch}`,
  '-e',
  `MOARTUBE_DESKTOP_ENGINE_ARCH=${engineArchitecture}`,
  '-e',
  `MOARTUBE_DEPENDENCIES_PREPARED=${prepared ? '1' : '0'}`,
  '-e',
  `MOARTUBE_DESKTOP_VARIANT=${variant}`,
  '-e',
  `MOARTUBE_DESKTOP_DIR=${dir ? '1' : '0'}`,
  ...(variants.includes('bundled')
    ? [
        '-e',
        'MOARTUBE_NODE_SOURCE=/workspace/build/desktop/node-source',
        '-e',
        'MOARTUBE_NODE_BUILD_DEPS=/opt/moartube-node-source',
      ]
    : []),
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
    'tests',
    '.github',
    'vitest.desktop.config.ts',
    'vitest.config.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'tsup.config.ts',
    'LICENSE.md',
    'README.md',
  ]) {
    const source = path.join(root, item);
    // Prepared images already contain scripts/. Copy its contents rather than
    // accidentally nesting it as scripts/scripts when Docker finds the folder.
    docker([
      'cp',
      statSync(source).isDirectory() ? `${source}${path.sep}.` : source,
      `${name}:/workspace/${item}`,
    ]);
  }
  if (variants.includes('bundled')) {
    const source = path.resolve(
      process.env.MOARTUBE_NODE_SOURCE || path.join(root, '../MoarTube-Node')
    );
    const input = path.resolve(layout.work, 'node-source-input');
    if (!input.startsWith(path.resolve(layout.work) + path.sep))
      throw new Error('Invalid Node input path');
    rmSync(input, { recursive: true, force: true });
    // Copy an allowlisted checkout; installed dependencies come from the target image.
    for (const item of [
      'src',
      'public',
      'drizzle',
      'bin',
      'scripts',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsup.config.ts',
      'LICENSE.md',
      'resources/cloudflared/LICENSE',
      'resources/cloudflared/README.md',
    ]) {
      const sourceFile = path.join(source, item);
      if (item.endsWith('README.md') && !existsSync(sourceFile)) continue;
      const relative = item.split('/');
      // Docker cp requires parent directories to exist, including in stopped containers.
      const parent = path.join(layout.work, 'node-source-input', ...relative.slice(0, -1));
      mkdirSync(parent, { recursive: true });
      const destination = path.join(parent, relative.at(-1));
      cpSync(sourceFile, destination, { recursive: true });
    }
    docker([
      'cp',
      path.join(layout.work, 'node-source-input'),
      `${name}:/workspace/build/desktop/node-source`,
    ]);
  }
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
  if (!dir)
    docker(['cp', `${name}:/workspace/build/desktop/releases/${target}/${version}/.`, output]);
  else {
    mkdirSync(layout.packages, { recursive: true });
    docker(['cp', `${name}:/workspace/build/desktop/work/${target}/packages/.`, layout.packages]);
  }
  mkdirSync(layout.reports, { recursive: true });
  docker(['cp', `${name}:/workspace/build/desktop/reports/${target}/.`, layout.reports]);
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
