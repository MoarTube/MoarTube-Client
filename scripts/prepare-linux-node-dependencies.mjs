import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLinuxDesktopArgs } from '../desktop/linux-variant.cjs';
import { desktopPaths } from '../tooling/build-paths.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { arch, target, dockerPlatform } = parseLinuxDesktopArgs(process.argv.slice(2));
const source = path.resolve(
  process.env.MOARTUBE_NODE_SOURCE || path.join(root, '../MoarTube-Node')
);
const layout = desktopPaths(root, target);
const context = path.join(layout.work, 'node-dependencies-context');
mkdirSync(context, { recursive: true });
for (const name of ['package.json', 'package-lock.json'])
  copyFileSync(path.join(source, name), path.join(context, name));
for (const name of ['install-cloudflared.mjs', 'cloudflared-release.mjs'])
  copyFileSync(path.join(source, 'scripts', name), path.join(context, name));
copyFileSync(
  path.join(root, 'desktop/linux/node-dependencies.Dockerfile'),
  path.join(context, 'Dockerfile')
);
const cache = path.join(layout.cache, 'node-dependencies', arch);
mkdirSync(cache, { recursive: true });
const archive = path.join(cache, 'downloads-cache.tar');
if (existsSync(archive)) copyFileSync(archive, path.join(context, 'downloads-cache.tar'));
else writeFileSync(path.join(context, 'downloads-cache.tar'), Buffer.alloc(1024));
const run = (args) => {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0)
    throw (
      result.error ??
      new Error(`Linux Node dependencies: docker ${args[0]} failed (${result.status})`)
    );
};
const image = `moartube-desktop-node-dependencies-${arch}:ubuntu24`;
const base = `moartube-desktop-${process.env.MOARTUBE_DEPENDENCIES_PREPARED === '1' ? 'dependencies' : 'builder'}-${arch}:ubuntu24`;
run([
  'build',
  '--platform',
  dockerPlatform,
  '--build-arg',
  `BASE_IMAGE=${base}`,
  '-t',
  image,
  context,
]);
const name = `moartube-node-cache-${arch}-${process.pid}`;
run([
  'create',
  '--platform',
  dockerPlatform,
  '--name',
  name,
  image,
  'tar',
  '-cf',
  '/downloads-cache.tar',
  '-C',
  '/root',
  '.npm',
]);
try {
  run(['start', '-a', name]);
  run(['cp', `${name}:/downloads-cache.tar`, archive]);
} finally {
  run(['rm', name]);
}
