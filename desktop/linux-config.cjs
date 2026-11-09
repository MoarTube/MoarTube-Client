const fs = require('node:fs');
const path = require('node:path');
const { linuxVariant, linuxPaths } = require('./linux-variant.cjs');
const { prepareBuilderCache } = require('./builder-cache.cjs');
prepareBuilderCache(process.env.ELECTRON_BUILDER_CACHE);

module.exports = function createLinuxConfig(variant, root = path.resolve(__dirname, '..')) {
  const selected = linuxVariant(variant);
  const arch = process.env.MOARTUBE_DESKTOP_ARCH ?? process.arch;
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(arch) || process.arch !== arch)
    throw new Error('Build Linux desktop packages with matching native Linux dependencies.');
  const target = `linux-${arch}`;
  const layout = linuxPaths(root, arch, require('../package.json').version, selected.name);
  const selection = JSON.parse(fs.readFileSync(layout.selection, 'utf8'));
  const runtime = path.resolve(selection.runtimeDirectory);
  const node = path.resolve(selection.nodeRuntimeDirectory);
  for (const directory of [runtime, node])
    if (!directory.startsWith(layout.staging + path.sep))
      throw new Error('Invalid Linux staging directory');
  return {
    electronDownload: { cache: process.env.ELECTRON_CACHE },
    appId: selected.appId,
    productName: selected.productName,
    executableName: selected.executable,
    directories: { output: layout.packages, buildResources: 'desktop' },
    extraMetadata: {
      main: 'desktop/main.cjs',
      moartubeBundledNode: selected.bundled,
      desktopName: selected.desktopName,
    },
    files: [
      'dist/**/*',
      'desktop/main.cjs',
      'desktop/autostart.cjs',
      'src/config/data-layout.cjs',
      'desktop/policy.cjs',
      'desktop/linux-processes.cjs',
      'desktop/bundled-node.cjs',
      'desktop/loading.html',
      'package.json',
      '!dist/**/*.map',
      '!dist/**/*.d.ts',
      { from: path.join(layout.assets, 'icon.png'), to: 'desktop/icon.png' },
    ],
    asar: true,
    asarUnpack: ['dist/**/*', 'node_modules/**/*', 'package.json'],
    npmRebuild: false,
    extraResources: [
      { from: runtime, to: `ffmpeg/${target}`, filter: ['**/*'] },
      { from: node, to: 'runtime', filter: ['node', 'LICENSE', 'NOTICES.txt'] },
      ...(selected.bundled
        ? [
            { from: path.join(layout.staging, 'bundled/node'), to: 'node', filter: ['**/*'] },
            {
              from: path.join(layout.staging, 'bundled/node/node_modules'),
              to: 'node/node_modules',
              filter: ['**/*'],
            },
            { from: path.join(layout.staging, 'bundled/bundle.json'), to: 'bundle.json' },
          ]
        : []),
      { from: 'LICENSE.md', to: 'MoarTube-LICENSE.md' },
    ],
    afterPack({ appOutDir }) {
      const resources = path.join(appOutDir, 'resources');
      const asar = require('@electron/asar');
      for (const name of [
        'desktop/main.cjs',
        'desktop/autostart.cjs',
        'desktop/loading.html',
        'src/config/data-layout.cjs',
      ])
        if (
          !asar
            .extractFile(path.join(resources, 'app.asar'), path.normalize(name))
            .equals(fs.readFileSync(path.join(root, name)))
        )
          throw new Error(
            `Packaged ${name} differs from source; do not change files while packaging.`
          );
      if (selected.bundled)
        require('node:child_process').execFileSync(
          path.join(resources, 'runtime/node'),
          [
            '--input-type=commonjs',
            '-e',
            "require('bcryptjs');const Database=require('better-sqlite3');const db=new Database(':memory:');db.exec('create table packaged_preflight (id integer)');db.close();console.log('Packaged Node native SQLite passed');",
          ],
          { cwd: path.join(resources, 'node'), stdio: 'inherit' }
        );
    },
    artifactName: selected.prefix + '-${version}-linux-${arch}-portable.${ext}',
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
      desktop: { entry: { StartupWMClass: selected.packageName } },
    },
    deb: {
      artifactName: selected.prefix + '-${version}-' + target + '.deb',
      packageName: selected.packageName,
      depends: require('./linux/runtime-packages.json'),
    },
    publish: null,
  };
};
