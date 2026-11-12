const { windowsVariant, windowsPaths } = require('./windows-variant.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { prepareBuilderCache } = require('./builder-cache.cjs');
const { prepareNsisInclude } = require('./nsis.cjs');
prepareBuilderCache(process.env.ELECTRON_BUILDER_CACHE);
// Both backends read JavaScript from ASAR. External binaries and public assets
// stay unpacked; development artifacts are excluded during runtime staging.
const dependencyExclusions = [
  '**/*.map',
  '**/*.d.{ts,mts,cts}',
  '**/{test,tests,__tests__,example,examples,benchmark,benchmarks}/**/*',
];
module.exports = function createWindowsConfig(variant, root = path.resolve(__dirname, '..')) {
  const selected = windowsVariant(variant);
  const layout = windowsPaths(root, require('../package.json').version, selected.name);
  const selectionPath = layout.selection;
  if (!fs.existsSync(selectionPath))
    throw new Error(
      'Desktop resources are missing. Use npm run desktop:build:windows:all to prepare and package them.'
    );
  const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
  const directory = path.resolve(selection.runtimeDirectory);
  if (!directory.startsWith(layout.staging + path.sep) || path.basename(directory) !== 'runtime')
    throw new Error('Invalid desktop FFmpeg candidate path');
  return {
    electronDownload: { cache: process.env.ELECTRON_CACHE },
    appId: selected.appId,
    productName: selected.productName,
    executableName: selected.productName,
    directories: {
      app: path.join(layout.staging, 'javascript/client'),
      output: layout.packages,
      buildResources: 'desktop',
    },
    extraMetadata: { main: 'desktop/main.cjs', moartubeBundledNode: selected.bundled },
    files: [
      'dist/**/*',
      'vendor/**/*',
      'bin/check-node-version.js',
      'desktop/main.cjs',
      'desktop/autostart.cjs',
      'src/config/data-layout.cjs',
      'desktop/policy.cjs',
      'desktop/linux-processes.cjs',
      'desktop/bundled-node.cjs',
      'desktop/loading.html',
      'desktop/loading.js',
      'package.json',
      'THIRD-PARTY-NOTICES.txt',
      '!dist/**/*.map',
      '!dist/**/*.d.ts',
      ...dependencyExclusions.map((pattern) => `!node_modules/${pattern}`),
    ],
    asar: true,
    asarUnpack: [
      'dist/**/*',
      'bin/check-node-version.js',
      'package.json',
      'node_modules/@imagemagick/magick-wasm/**/*',
      'node_modules/**/*.node',
      'node_modules/**/*.dll',
      'node_modules/thread-stream/lib/worker.js',
      'node_modules/pino/lib/worker.js',
    ],
    npmRebuild: false,
    extraResources: [
      ...(selected.bundled
        ? [
            {
              from: path.join(layout.staging, 'javascript/node.asar'),
              to: 'node.asar',
            },
            {
              from: path.join(layout.staging, 'javascript/node.asar.unpacked'),
              to: 'node.asar.unpacked',
              filter: ['**/*'],
            },
            // electron-builder excludes a FileSet's root node_modules directory.
            {
              from: path.join(layout.staging, 'javascript/node.asar.unpacked/node_modules'),
              to: 'node.asar.unpacked/node_modules',
              filter: ['**/*', ...dependencyExclusions.map((pattern) => `!${pattern}`)],
            },
            {
              from: path.join(layout.staging, 'javascript/node/SOURCES.txt'),
              to: 'node-SOURCES.txt',
            },
            { from: path.join(layout.staging, 'javascript/bundle.json'), to: 'bundle.json' },
          ]
        : []),
      { from: directory, to: 'ffmpeg/win32-x64', filter: ['**/*'] },
      { from: 'LICENSE.md', to: 'MoarTube-LICENSE.md' },
    ],
    async afterPack({ appOutDir, packager }) {
      const archive = path.join(appOutDir, 'resources/app.asar');
      const asar = require('@electron/asar');
      for (const name of [
        'desktop/main.cjs',
        'desktop/autostart.cjs',
        'desktop/loading.html',
        'desktop/loading.js',
        'src/config/data-layout.cjs',
      ]) {
        if (
          !asar
            .extractFile(archive, path.normalize(name))
            .equals(fs.readFileSync(path.join(root, name)))
        )
          throw new Error(
            `Packaged ${name} differs from source. Keep source files unchanged while packaging and rebuild.`
          );
      }
      if (asar.statFile(archive, path.normalize('node_modules/fastify/fastify.js')).unpacked)
        throw new Error('Client JavaScript dependencies must be packaged inside ASAR.');
      require('node:child_process').execFileSync(
        path.join(appOutDir, selected.productName + '.exe'),
        [path.join(root, 'scripts/desktop-image-probe.cjs'), path.join(appOutDir, 'resources')],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 120_000 }
      );
      if (!selected.bundled) return;
      const resources = path.join(appOutDir, 'resources');
      if (
        fs.existsSync(path.join(resources, 'runtime')) ||
        fs.existsSync(path.join(resources, 'node'))
      )
        throw new Error(
          'Windows bundles must not ship a standalone Node runtime or loose Node tree.'
        );
      const bundle = JSON.parse(fs.readFileSync(path.join(resources, 'bundle.json'), 'utf8'));
      if (
        bundle.runtimeHost !== 'electron' ||
        bundle.electronVersion !== packager.info.framework.version
      )
        throw new Error('Bundled Node was staged for a different Electron runtime.');
      const source = bundle.applicationSource;
      if (
        !source ||
        path.basename(source.archive) !== source.archive ||
        require('node:crypto')
          .createHash('sha256')
          .update(fs.readFileSync(path.join(layout.release, source.archive)))
          .digest('hex') !== source.sha256
      )
        throw new Error('The matching Client + Node source archive is missing or changed.');
      for (const [name, expected] of Object.entries(source.runtimeFiles ?? {})) {
        const file = path.resolve(resources, name);
        const content = name.startsWith('node.asar/')
          ? asar.extractFile(
              path.join(resources, 'node.asar'),
              path.normalize(name.slice('node.asar/'.length))
            )
          : fs.readFileSync(file);
        if (
          !file.startsWith(resources + path.sep) ||
          require('node:crypto').createHash('sha256').update(content).digest('hex') !== expected
        )
          throw new Error(
            `Packaged ${name} does not match its source archive. Rebuild the desktop JavaScript staging.`
          );
      }
      const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
      const { FuseState } = require('@electron/fuses/dist/constants');
      const wire = await getCurrentFuseWire(path.join(appOutDir, selected.productName + '.exe'));
      if (wire[FuseV1Options.RunAsNode] !== FuseState.ENABLE)
        throw new Error('Electron RunAsNode must remain enabled for bundled Node cluster workers.');
      const verified = require('./node-runtime.cjs').verifyNodeRuntime(
        root,
        path.join(resources, 'node.asar')
      );
      for (const key of [
        'electronVersion',
        'runtimeVersion',
        'sqlitePackageVersion',
        'sqliteVersion',
        'cloudflaredVersion',
      ])
        if (verified[key] !== bundle[key])
          throw new Error(`Packaged Node ${key} differs from staging.`);
      console.log('Packaged Electron-hosted Node native SQLite passed', verified);
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
      include: prepareNsisInclude(root, layout.state),
      // ZIP uses NSIS's faster direct extraction path. Differential packages require 7z.
      useZip: true,
      differentialPackage: false,
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
