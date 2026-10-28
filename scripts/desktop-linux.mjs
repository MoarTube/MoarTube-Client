import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(root, 'build/ffmpeg/artifacts/linux-x64');
if (!existsSync(path.join(artifacts, 'selected.json')))
  throw new Error('Compile FFmpeg first: npm run ffmpeg:build:linux');
const selected = JSON.parse(readFileSync(path.join(artifacts, 'selected.json'), 'utf8'));
if (
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(selected.buildId) ||
  selected.sourceArchive !== `${selected.buildId}-sources.tar.xz`
)
  throw new Error('Invalid Linux FFmpeg candidate');
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
const image = 'moartube-desktop-builder:ubuntu24';
docker(['build', '--platform', 'linux/amd64', '-t', image, 'desktop/linux']);
const name = `moartube-desktop-build-${process.pid}`;
const envArgs = process.env.MOARTUBE_RELEASE_TAG
  ? ['-e', `MOARTUBE_RELEASE_TAG=${process.env.MOARTUBE_RELEASE_TAG}`]
  : [];
docker([
  'create',
  '--platform',
  'linux/amd64',
  '--name',
  name,
  ...envArgs,
  '-e',
  'CSC_IDENTITY_AUTO_DISCOVERY=false',
  image,
  'bash',
  '-lc',
  'npm ci --include=optional --ignore-scripts --no-audit --no-fund && node node_modules/electron/install.js && npm run desktop:test && npm run desktop:dist:linux:native',
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
  const target = `${name}:/workspace/build/ffmpeg/artifacts/linux-x64`;
  for (const item of [selected.buildId, selected.sourceArchive, 'selected.json', 'SHA256SUMS.txt'])
    docker(['cp', path.join(artifacts, item), `${target}/${item}`]);
  docker(['start', '-a', name]);
  const code = docker(['inspect', name, '--format', '{{.State.ExitCode}}'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.trim();
  if (code !== '0') throw new Error(`Linux desktop build failed; container retained: ${name}`);
  const output = path.join(root, 'build/desktop/output/linux');
  mkdirSync(output, { recursive: true });
  docker(['cp', `${name}:/workspace/build/desktop/output/linux/.`, output]);
  docker(['rm', name]);
  console.log(`Linux desktop artifacts: ${output}`);
} catch (error) {
  console.error(`Build container retained for diagnostics: ${name}`);
  throw error;
}
