const { desktopPaths } = require('../tooling/build-paths.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { prepareBuilderCache } = require('./builder-cache.cjs');
prepareBuilderCache(process.env.ELECTRON_BUILDER_CACHE);
if (process.platform !== 'darwin' || !['x64', 'arm64'].includes(process.arch))
  throw new Error(
    'Build the macOS desktop on a matching native Intel or Apple Silicon Mac runner.'
  );
const root = path.resolve(__dirname, '..');
const arch = process.arch;
const target = `darwin-${arch}`;
const layout = desktopPaths(root, target, require('../package.json').version);
const selection = JSON.parse(fs.readFileSync(layout.selection, 'utf8'));
const runtime = path.resolve(selection.runtimeDirectory);
const node = path.resolve(selection.nodeRuntimeDirectory);
for (const directory of [runtime, node])
  if (!directory.startsWith(layout.staging + path.sep))
    throw new Error('Invalid Darwin staging directory');
module.exports = {
  electronDownload: { cache: process.env.ELECTRON_CACHE },
  appId: 'com.moartube.client',
  productName: 'MoarTube Client',
  executableName: 'MoarTube Client',
  directories: { output: layout.packages, buildResources: 'desktop' },
  extraMetadata: { main: 'desktop/main.cjs' },
  files: [
    'dist/**/*',
    'desktop/main.cjs',
    'desktop/policy.cjs',
    'desktop/linux-processes.cjs',
    'desktop/loading.html',
    'package.json',
    '!dist/**/*.map',
    '!dist/**/*.d.ts',
  ],
  asar: true,
  asarUnpack: ['dist/**/*', 'node_modules/**/*', 'package.json'],
  npmRebuild: false,
  extraResources: [
    { from: runtime, to: `ffmpeg/${target}` },
    { from: node, to: 'runtime', filter: ['node', 'LICENSE', 'NOTICES.txt'] },
    { from: 'LICENSE.md', to: 'MoarTube-LICENSE.md' },
  ],
  artifactName: 'MoarTube-Client-${version}-' + target + '.${ext}',
  mac: {
    target: [
      { target: 'dmg', arch: [arch] },
      { target: 'zip', arch: [arch] },
    ],
    icon: path.join(layout.assets, 'icon.png'),
    category: 'public.app-category.video',
    minimumSystemVersion: '15.0',
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
    // These binaries were ad-hoc signed before their immutable manifest hashes
    // were recorded. Preserve those signatures when signing the enclosing app.
    signIgnore: ['Contents/Resources/ffmpeg/'],
  },
  dmg: { sign: false },
  publish: null,
};
