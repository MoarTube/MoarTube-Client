const { windowsVariant, windowsPaths } = require('./windows-variant.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { prepareBuilderCache } = require('./builder-cache.cjs');
prepareBuilderCache(process.env.ELECTRON_BUILDER_CACHE);
module.exports = function createWindowsConfig(variant, root = path.resolve(__dirname, '..')) {
  const selected = windowsVariant(variant);
  const layout = windowsPaths(root, require('../package.json').version, selected.name);
  const selectionPath = layout.selection;
  if (!fs.existsSync(selectionPath)) throw new Error('Run npm run desktop:prepare first.');
  const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
  const directory = path.resolve(selection.runtimeDirectory);
  if (!directory.startsWith(layout.staging + path.sep) || path.basename(directory) !== 'runtime')
    throw new Error('Invalid desktop FFmpeg candidate path');
  return {
    electronDownload: { cache: process.env.ELECTRON_CACHE },
    appId: selected.appId,
    productName: selected.productName,
    executableName: selected.productName,
    directories: { output: layout.packages, buildResources: 'desktop' },
    extraMetadata: { main: 'desktop/main.cjs', moartubeBundledNode: selected.bundled },
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
    ],
    asar: true,
    asarUnpack: ['dist/**/*', 'node_modules/**/*', 'package.json'],
    npmRebuild: false,
    extraResources: [
      ...(selected.bundled
        ? [
            { from: path.join(layout.staging, 'bundled/node'), to: 'node', filter: ['**/*'] },
            // electron-builder excludes a FileSet's root node_modules directory. Copy
            // this isolated production dependency tree with its own explicit FileSet.
            {
              from: path.join(layout.staging, 'bundled/node/node_modules'),
              to: 'node/node_modules',
              filter: ['**/*'],
            },
            { from: path.join(layout.staging, 'bundled/runtime'), to: 'runtime', filter: ['**/*'] },
            { from: path.join(layout.staging, 'bundled/bundle.json'), to: 'bundle.json' },
          ]
        : []),
      { from: directory, to: 'ffmpeg/win32-x64', filter: ['**/*'] },
      { from: 'LICENSE.md', to: 'MoarTube-LICENSE.md' },
    ],
    afterPack({ appOutDir }) {
      const archive = path.join(appOutDir, 'resources/app.asar');
      const asar = require('@electron/asar');
      for (const name of ['desktop/main.cjs', 'desktop/autostart.cjs', 'desktop/loading.html', 'src/config/data-layout.cjs']) {
        if (!asar.extractFile(archive, path.normalize(name)).equals(fs.readFileSync(path.join(root, name))))
          throw new Error(`Packaged ${name} differs from source. Keep source files unchanged while packaging and rebuild.`);
      }
      if (!selected.bundled) return;
      const resources = path.join(appOutDir, 'resources');
      require('node:child_process').execFileSync(
        path.join(resources, 'runtime/node.exe'),
        [
          '--input-type=commonjs',
          '-e',
          "require('bcryptjs');const Database=require('better-sqlite3');const db=new Database(':memory:');db.exec('create table packaged_preflight (id integer)');db.close();console.log('Packaged Node dependencies and native SQLite passed');",
        ],
        { cwd: path.join(resources, 'node'), stdio: 'inherit', windowsHide: true }
      );
    },
    forceCodeSigning: false,
    artifactName: selected.prefix + '-${version}-windows-${arch}-portable.${ext}',
    win: {
      target: [
        { target: 'nsis', arch: ['x64'] },
        { target: 'zip', arch: ['x64'] },
      ],
      icon: path.join(layout.assets, 'icon.ico'),
      signExecutable: false,
    },
    nsis: {
      include: path.join(__dirname, 'autostart-installer.nsh'),
      oneClick: false,
      perMachine: false,
      selectPerMachineByDefault: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      artifactName: selected.prefix + '-${version}-windows-${arch}-setup.${ext}',
    },
    publish: null,
  };
};
