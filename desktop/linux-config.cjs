const fs = require('node:fs');
const path = require('node:path');
const { linuxVariant, linuxPaths, deferImageProbeToVm } = require('./linux-variant.cjs');
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
  for (const directory of [runtime])
    if (!directory.startsWith(layout.staging + path.sep))
      throw new Error('Invalid Linux staging directory');
  return {
    electronDownload: { cache: process.env.ELECTRON_CACHE },
    appId: selected.appId,
    productName: selected.productName,
    executableName: selected.executable,
    directories: {
      output: layout.packages,
      buildResources: 'desktop',
      app: path.join(layout.staging, 'javascript/client'),
    },
    extraMetadata: {
      main: 'desktop/main.cjs',
      moartubeBundledNode: selected.bundled,
      desktopName: selected.desktopName,
    },
    files: [
      'dist/**/*',
      'vendor/**/*',
      'THIRD-PARTY-NOTICES.txt',
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
      '!dist/**/*.map',
      '!dist/**/*.d.ts',
      { from: path.join(layout.assets, 'icon.png'), to: 'desktop/icon.png' },
    ],
    asar: { smartUnpack: false },
    asarUnpack: [
      'dist/**/*',
      'bin/check-node-version.js',
      'package.json',
      'node_modules/@imagemagick/magick-wasm/**/*',
      'node_modules/**/*.node',
      'node_modules/**/*.so*',
      'node_modules/thread-stream/lib/worker.js',
      'node_modules/pino/lib/worker.js',
    ],
    npmRebuild: false,
    extraResources: [
      { from: runtime, to: `ffmpeg/${target}`, filter: ['**/*'] },
      ...(selected.bundled
        ? [
            { from: path.join(layout.staging, 'javascript/node.asar'), to: 'node.asar' },
            {
              from: path.join(layout.staging, 'javascript/node.asar.unpacked'),
              to: 'node.asar.unpacked',
              filter: ['**/*'],
            },
            {
              from: path.join(layout.staging, 'javascript/node.asar.unpacked/node_modules'),
              to: 'node.asar.unpacked/node_modules',
              filter: ['**/*'],
            },
            {
              from: path.join(layout.staging, 'javascript/node/SOURCES.txt'),
              to: 'node-SOURCES.txt',
            },
            { from: path.join(layout.staging, 'javascript/bundle.json'), to: 'bundle.json' },
          ]
        : []),
      { from: 'LICENSE.md', to: 'MoarTube-LICENSE.md' },
    ],
    async afterPack({ appOutDir, packager }) {
      const resources = path.join(appOutDir, 'resources');
      const asar = require('@electron/asar');
      for (const name of [
        'desktop/main.cjs',
        'desktop/autostart.cjs',
        'desktop/loading.html',
        'desktop/loading.js',
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
      const executable = path.join(appOutDir, selected.executable);
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
      const deferred = deferImageProbeToVm(arch, process.env.MOARTUBE_DESKTOP_ENGINE_ARCH);
      if (deferred) {
        // Electron ARM64's WASM initialization faults under user-mode QEMU.
        // Keep the installed/portable probe mandatory in the full-system VM.
        console.log(
          'ARM64 image runtime probe deferred to full-system VM verification; not yet qualified.'
        );
      } else {
        require('node:child_process').execFileSync(
          executable,
          [path.join(root, 'scripts/desktop-image-probe.cjs'), resources],
          { env, stdio: 'inherit', timeout: 120_000 }
        );
      }
      fs.mkdirSync(layout.reports, { recursive: true });
      fs.writeFileSync(
        path.join(layout.reports, 'image-probe.json'),
        JSON.stringify(
          {
            target,
            status: deferred ? 'deferred-to-full-system-vm' : 'passed',
            engineArchitecture: process.env.MOARTUBE_DESKTOP_ENGINE_ARCH ?? process.arch,
            ...(deferred
              ? { verificationCommand: 'npm run desktop:verify:linux:arm64:vm:all' }
              : {}),
          },
          null,
          2
        ) + '\n'
      );
      if (
        asar.statFile(path.join(resources, 'app.asar'), 'node_modules/fastify/fastify.js').unpacked
      )
        throw new Error('Client JavaScript dependencies must remain inside ASAR.');
      if (
        fs.existsSync(path.join(resources, 'runtime')) ||
        fs.existsSync(path.join(resources, 'node'))
      )
        throw new Error(
          'Linux packages must use Electron backends without a standalone Node runtime.'
        );
      if (
        asar
          .listPackage(path.join(resources, 'app.asar'))
          .some((name) =>
            /node_modules\/(?:sharp|@janhapke\/sharp-electron|@img\/sharp)/.test(name)
          )
      )
        throw new Error('Obsolete Sharp dependency included in the Client package.');
      if (selected.bundled)
        await require('./node-package.cjs').verifyNodePackage({
          root,
          resources,
          executable: path.join(appOutDir, selected.executable),
          release: layout.release,
          electronVersion: packager.info.framework.version,
          target,
        });
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
      compression: 'zst',
      artifactName: selected.prefix + '-${version}-' + target + '.deb',
      packageName: selected.packageName,
      depends: require('./linux/runtime-packages.json'),
    },
    publish: null,
  };
};
