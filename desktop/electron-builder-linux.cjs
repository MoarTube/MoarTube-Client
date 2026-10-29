const { desktopPaths } = require('../tooling/build-paths.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { prepareBuilderCache } = require('./builder-cache.cjs');
prepareBuilderCache(process.env.ELECTRON_BUILDER_CACHE);
const root = path.resolve(__dirname, '..');
const arch = process.env.MOARTUBE_DESKTOP_ARCH ?? process.arch;
if (!['x64', 'arm64'].includes(arch) || process.platform !== 'linux' || process.arch !== arch)
  throw new Error('Build Linux desktop packages with matching x64/ARM64 Linux dependencies.');
const target = `linux-${arch}`;
const layout = desktopPaths(root, target, require('../package.json').version);
const selection = JSON.parse(fs.readFileSync(layout.selection, 'utf8'));
const directory = path.resolve(selection.runtimeDirectory);
const nodeDirectory = path.resolve(selection.nodeRuntimeDirectory);
if (!nodeDirectory.startsWith(layout.staging + path.sep))
  throw new Error('Invalid bundled Node staging directory.');
if (!directory.startsWith(layout.staging + path.sep) || path.basename(directory) !== 'runtime')
  throw new Error('Run npm run desktop:prepare:linux to select a verified Linux FFmpeg candidate');
module.exports = {
  electronDownload: { cache: process.env.ELECTRON_CACHE },
  appId: 'com.moartube.client',
  productName: 'MoarTube Client',
  // Keep the existing npm CLI command available alongside the desktop option.
  executableName: 'moartube-client-desktop',
  directories: { output: layout.packages, buildResources: 'desktop' },
  extraMetadata: { main: 'desktop/main.cjs', desktopName: 'moartube-client.desktop' },
  files: [
    'dist/**/*',
    'desktop/main.cjs',
    'desktop/policy.cjs',
    'desktop/linux-processes.cjs',
    'desktop/loading.html',
    'package.json',
    '!dist/**/*.map',
    '!dist/**/*.d.ts',
    { from: path.join(layout.assets, 'icon.png'), to: 'desktop/icon.png' },
  ],
  asar: true,
  // Standalone Node reads the backend/dependencies from regular files, avoiding
  // Electron's GLib symbol conflicts with Sharp. The renderer shell stays in ASAR.
  asarUnpack: ['dist/**/*', 'node_modules/**/*', 'package.json'],
  npmRebuild: false,
  extraResources: [
    { from: directory, to: `ffmpeg/${target}`, filter: ['**/*'] },
    { from: nodeDirectory, to: 'runtime', filter: ['node', 'LICENSE', 'NOTICES.txt'] },
    { from: 'LICENSE.md', to: 'MoarTube-LICENSE.md' },
  ],
  artifactName: 'MoarTube-Client-${version}-linux-${arch}.${ext}',
  linux: {
    syncDesktopName: true,
    target: [
      { target: 'deb', arch: [arch] },
      { target: 'tar.gz', arch: [arch] },
    ],
    icon: path.join(layout.assets, 'icon.png'),
    category: 'AudioVideo',
    maintainer: 'MoarTube, LLC',
    synopsis: 'MoarTube video publishing and live streaming client',
  },
  deb: {
    artifactName: 'MoarTube-Client-${version}-' + target + '.deb',
    packageName: 'moartube-client',
    depends: require('./linux/runtime-packages.json'),
  },
  publish: null,
};
