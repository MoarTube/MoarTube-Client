import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLinuxTarget } from '../tooling/ffmpeg/scripts/linux-target.mjs';
import { desktopPaths } from '../tooling/build-paths.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const flags = new Set(process.argv.slice(2));
const desktop = flags.has('--desktop');
const skipCompiler = flags.has('--skip-compiler');
const { arch, target, dockerPlatform } = parseLinuxTarget(
  process.argv.slice(2).filter((arg) => !['--desktop', '--skip-compiler'].includes(arg))
);
const run = (args) => {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0)
    throw (
      result.error ??
      new Error(`Dependency preparation: docker ${args[0]} failed (${result.status})`)
    );
};
if (!skipCompiler)
  run([
    'build',
    '--platform',
    dockerPlatform,
    '-t',
    `moartube-ffmpeg-${target}:ubuntu24`,
    'tooling/ffmpeg/platforms/linux',
  ]);
const images = JSON.parse(
  readFileSync(path.join(root, 'tooling/ffmpeg/platforms/linux/runtime-images.json'), 'utf8')
);
if (desktop) {
  run([
    'build',
    '--platform',
    dockerPlatform,
    '-t',
    `moartube-desktop-builder-${arch}:ubuntu24`,
    'desktop/linux',
  ]);
  const context = path.join(desktopPaths(root, target).work, 'dependencies-context');
  mkdirSync(context, { recursive: true });
  for (const file of ['package.json', 'package-lock.json'])
    copyFileSync(path.join(root, file), path.join(context, file));
  copyFileSync(
    path.join(root, 'scripts/prefetch-desktop-tools.mjs'),
    path.join(context, 'prefetch-desktop-tools.mjs')
  );
  copyFileSync(
    path.join(root, 'desktop/linux/dependencies.Dockerfile'),
    path.join(context, 'Dockerfile')
  );
  const cached = path.join(root, 'build/desktop/cache/dependencies', arch);
  const archive = path.join(cached, 'downloads-cache.tar');
  if (existsSync(archive)) copyFileSync(archive, path.join(context, 'downloads-cache.tar'));
  else writeFileSync(path.join(context, 'downloads-cache.tar'), Buffer.alloc(1024));
  run([
    'build',
    '--platform',
    dockerPlatform,
    '--build-arg',
    `BASE_IMAGE=moartube-desktop-builder-${arch}:ubuntu24`,
    '-t',
    `moartube-desktop-dependencies-${arch}:ubuntu24`,
    context,
  ]);
  const exportName = `moartube-dependency-cache-${arch}-${process.pid}`;
  run([
    'create',
    '--platform',
    dockerPlatform,
    '--name',
    exportName,
    `moartube-desktop-dependencies-${arch}:ubuntu24`,
    'tar',
    '-cf',
    '/downloads-cache.tar',
    '-C',
    '/root',
    '.npm',
    '.cache/electron',
    '.cache/electron-builder',
  ]);
  try {
    run(['start', '-a', exportName]);
    mkdirSync(cached, { recursive: true });
    run(['cp', `${exportName}:/downloads-cache.tar`, archive]);
  } finally {
    run(['rm', exportName]);
  }
  if (arch === 'arm64')
    Object.assign(
      images,
      JSON.parse(readFileSync(path.join(root, 'desktop/linux/arm64-runtime-images.json'), 'utf8'))
    );
}
for (const [version, image] of Object.entries(images)) {
  run([
    'build',
    '--platform',
    dockerPlatform,
    '-t',
    `moartube-${desktop ? 'desktop' : 'ffmpeg'}-runtime-${arch}:${version}`,
    '-f',
    desktop
      ? 'desktop/linux/runtime.Dockerfile'
      : 'tooling/ffmpeg/platforms/linux/runtime.Dockerfile',
    '--build-arg',
    `UBUNTU_IMAGE=${image}`,
    desktop ? 'desktop/linux' : 'tooling/ffmpeg/platforms/linux',
  ]);
}
console.log(`All ${target} container dependencies are prepared before compilation.`);
