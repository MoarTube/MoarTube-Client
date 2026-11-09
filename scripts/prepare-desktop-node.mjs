import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { desktopPaths } from '../tooling/build-paths.cjs';

const windows = process.platform === 'win32';
if (
  !(windows && process.arch === 'x64') &&
  !(process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch))
)
  throw new Error('Build bundled Node on matching Windows x64 or Linux x64/ARM64.');
const target = process.platform + '-' + process.arch;
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(
  process.env.MOARTUBE_NODE_SOURCE || path.join(root, '../MoarTube-Node')
);
if (
  JSON.parse(readFileSync(path.join(source, 'package.json'))).name !== '@moartube/moartube-node'
) {
  throw new Error('MOARTUBE_NODE_SOURCE must point to the MoarTube Node checkout');
}
const dependencies = process.env.MOARTUBE_NODE_BUILD_DEPS || source;
const layout = desktopPaths(root, target);
const bundle = path.join(layout.staging, 'bundled');
const destination = path.join(bundle, 'node');
if (path.resolve(destination) !== path.resolve(layout.staging, 'bundled/node'))
  throw new Error('Invalid Node staging directory');
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
// A deliberate source allowlist excludes local data, credentials and git metadata.
for (const name of [
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
]) {
  cpSync(path.join(source, name), path.join(destination, name), { recursive: true });
}
copyFileSync(
  path.join(root, 'desktop/node-bootstrap.mjs'),
  path.join(destination, 'desktop-bootstrap.mjs')
);
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
execFileSync(
  windows ? process.execPath : 'npm',
  [
    ...(windows ? [npm] : []),
    'ci',
    ...(process.env.MOARTUBE_DEPENDENCIES_PREPARED === '1' && !windows ? ['--offline'] : []),
    '--omit=dev',
    '--ignore-scripts',
    '--include=optional',
    '--no-audit',
    '--no-fund',
  ],
  { cwd: destination, stdio: 'inherit', windowsHide: true }
);
// Build SQLite for the standalone Node ABI, never Electron's ABI.
const native = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
mkdirSync(path.dirname(path.join(destination, native)), { recursive: true });
copyFileSync(path.join(dependencies, native), path.join(destination, native));

const requireNode = createRequire(path.join(dependencies, 'package.json'));
execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `import { build } from ${JSON.stringify(pathToFileURL(requireNode.resolve('tsup')).href)};\n` +
      `import config from ${JSON.stringify(pathToFileURL(path.join(source, 'tsup.config.ts')).href)};\n` +
      'await build({ ...config, config: false, dts: false });',
  ],
  { cwd: destination, stdio: 'inherit', windowsHide: true }
);

const { assets } = await import(
  pathToFileURL(path.join(source, 'scripts/cloudflared-release.mjs')).href
);
const cloudflared = path.join(
  dependencies,
  'resources/cloudflared',
  target,
  windows ? 'cloudflared.exe' : 'cloudflared'
);
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
if (!existsSync(cloudflared) || digest(cloudflared) !== assets[target].sha256) {
  throw new Error(
    'Install the verified Node Cloudflared runtime with npm run install:cloudflared in the Node checkout'
  );
}
const tunnelDirectory = path.join(destination, 'resources/cloudflared', target);
mkdirSync(tunnelDirectory, { recursive: true });
copyFileSync(cloudflared, path.join(tunnelDirectory, windows ? 'cloudflared.exe' : 'cloudflared'));
if (!windows) chmodSync(path.join(tunnelDirectory, 'cloudflared'), 0o755);
for (const name of ['LICENSE', 'README.md'])
  if (name === 'LICENSE' || existsSync(path.join(source, 'resources/cloudflared', name)))
    copyFileSync(
      path.join(source, 'resources/cloudflared', name),
      path.join(destination, 'resources/cloudflared', name)
    );

// The official distribution carries Node.js and all of its third-party notices.
const version = process.version;
const runtime = path.join(bundle, 'runtime');
mkdirSync(runtime, { recursive: true });
if (windows) {
  const archiveName = `node-${version}-win-x64.zip`;
  const cache = path.join(layout.cache, 'node', version);
  mkdirSync(cache, { recursive: true });
  async function download(name) {
    const file = path.join(cache, name);
    if (!existsSync(file)) {
      const response = await fetch(`https://nodejs.org/dist/${version}/${name}`);
      if (!response.ok) throw new Error(`Node.js download failed: ${response.status}`);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
    return file;
  }
  const checksums = readFileSync(await download('SHASUMS256.txt'), 'utf8');
  const checksum = checksums
    .split('\n')
    .find((line) => line.trim().endsWith(` ${archiveName}`))
    ?.trim()
    .split(/\s+/)[0];
  const archive = await download(archiveName);
  if (!checksum || digest(archive) !== checksum)
    throw new Error('Official Node.js archive checksum mismatch');
  execFileSync('tar.exe', ['-xf', archive, '-C', cache], { stdio: 'inherit', windowsHide: true });
  const distribution = path.join(cache, `node-${version}-win-x64`);
  for (const file of ['node.exe', 'LICENSE'])
    copyFileSync(path.join(distribution, file), path.join(runtime, file));
} else {
  const selection = JSON.parse(readFileSync(layout.selection, 'utf8'));
  if (selection.nodeVersion !== process.version)
    throw new Error('Bundled Node runtime version mismatch');
  for (const file of ['node', 'LICENSE', 'NOTICES.txt'])
    copyFileSync(path.join(selection.nodeRuntimeDirectory, file), path.join(runtime, file));
  chmodSync(path.join(runtime, 'node'), 0o755);
  const { assertLinuxElf } = await import('../tooling/ffmpeg/scripts/linux-elf.mjs');
  for (const file of [path.join(runtime, 'node'), path.join(destination, native), cloudflared])
    assertLinuxElf(readFileSync(file), process.arch);
}
execFileSync(
  path.join(runtime, windows ? 'node.exe' : 'node'),
  [
    '--input-type=commonjs',
    '-e',
    "const Database=require('better-sqlite3');const db=new Database(':memory:');db.exec('create table preflight (id integer)');db.close();console.log('Bundled SQLite native preflight passed');",
  ],
  { cwd: destination, stdio: 'inherit', windowsHide: true }
);
writeFileSync(
  path.join(bundle, 'bundle.json'),
  JSON.stringify(
    {
      nodeVersion: JSON.parse(readFileSync(path.join(destination, 'package.json'))).version,
      runtimeVersion: version,
      runtimeSha256: digest(path.join(runtime, windows ? 'node.exe' : 'node')),
      cloudflaredSha256: digest(cloudflared),
    },
    null,
    2
  )
);
console.log(`Bundled Node, corresponding source, Cloudflared and Node.js staged in ${bundle}`);
