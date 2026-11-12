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
import { verifyNodeRuntime } from '../desktop/node-runtime.cjs';
import desktopPolicy from '../desktop/policy.cjs';

const { usesElectronNode } = desktopPolicy;

const windows = process.platform === 'win32';
if (
  !(windows && process.arch === 'x64') &&
  !(['linux', 'darwin'].includes(process.platform) && ['x64', 'arm64'].includes(process.arch))
)
  throw new Error('Build bundled Node on matching Windows x64 or Linux/macOS x64/ARM64.');
const target = process.platform + '-' + process.arch;
const electronHosted = usesElectronNode(process.platform, process.arch);
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
copyFileSync(
  path.join(root, 'desktop/node-preflight.mjs'),
  path.join(destination, 'desktop-preflight.mjs')
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
// Every supported desktop target uses the package's matching Node-API addon.
const native = `node_modules/better-sqlite3/prebuilds/${target}.node`;
if (!electronHosted || !existsSync(path.join(destination, native)))
  throw new Error(
    'Electron-hosted bundles require the Node-API SQLite package (better-sqlite3 13.0.3 or newer).'
  );

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
if (
  !existsSync(cloudflared) ||
  digest(cloudflared) !== (assets[target].binarySha256 ?? assets[target].sha256)
) {
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

// Both backends use Electron on every supported desktop target.
const runtime = path.join(bundle, 'runtime');
if (path.resolve(runtime) !== path.resolve(layout.staging, 'bundled/runtime'))
  throw new Error('Invalid obsolete Node runtime staging directory');
rmSync(runtime, { recursive: true, force: true });
const runtimeMetadata = {
  runtimeHost: 'electron',
  buildNodeVersion: process.version,
  ...verifyNodeRuntime(root, destination),
};
writeFileSync(
  path.join(bundle, 'bundle.json'),
  JSON.stringify(
    {
      nodeVersion: JSON.parse(readFileSync(path.join(destination, 'package.json'))).version,
      ...runtimeMetadata,
      cloudflaredSha256: digest(cloudflared),
    },
    null,
    2
  )
);
console.log(`Bundled Node, corresponding source, Cloudflared and Node.js staged in ${bundle}`);
