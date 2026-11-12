const { darwinPaths, darwinVariant } = require('./darwin-variant.cjs');
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
const selected = darwinVariant(process.env.MOARTUBE_DESKTOP_VARIANT ?? 'client');
const layout = darwinPaths(root, arch, require('../package.json').version, selected.name);
const selection = JSON.parse(fs.readFileSync(layout.selection, 'utf8'));
const runtime = path.resolve(selection.runtimeDirectory);
for (const directory of [runtime])
  if (!directory.startsWith(layout.staging + path.sep))
    throw new Error('Invalid Darwin staging directory');
module.exports = {
  electronDownload: { cache: process.env.ELECTRON_CACHE },
  appId: selected.appId,
  productName: selected.productName,
  executableName: selected.executable,
  directories: {
    output: layout.packages,
    buildResources: 'desktop',
    app: path.join(layout.staging, 'javascript/client'),
  },
  extraMetadata: { main: 'desktop/main.cjs', moartubeBundledNode: selected.bundled },
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
    'desktop/darwin-processes.cjs',
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
    'node_modules/**/*.dylib',
    'node_modules/thread-stream/lib/worker.js',
    'node_modules/pino/lib/worker.js',
  ],
  compression: 'normal',
  npmRebuild: false,
  afterPack({ appOutDir, packager }) {
    const resources = path.join(
      appOutDir,
      packager.appInfo.productFilename + '.app/Contents/Resources'
    );
    const asar = require('@electron/asar');
    for (const name of [
      'desktop/main.cjs',
      'desktop/autostart.cjs',
      'desktop/darwin-processes.cjs',
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
    if (asar.statFile(path.join(resources, 'app.asar'), 'node_modules/fastify/fastify.js').unpacked)
      throw new Error('Client dependencies must remain inside ASAR.');
    if (
      fs.existsSync(path.join(resources, 'runtime')) ||
      fs.existsSync(path.join(resources, 'node'))
    )
      throw new Error('macOS backends must use Electron without a standalone Node runtime.');
    if (
      asar
        .listPackage(path.join(resources, 'app.asar'))
        .some((name) => /node_modules\/(?:sharp|@janhapke\/sharp-electron|@img\/sharp)/.test(name))
    )
      throw new Error('Obsolete Sharp dependency included in Client package.');
  },
  async afterSign({ appOutDir, packager }) {
    // The renamed .app must have its final signature before Electron executes,
    // especially on Apple Silicon. Do not move these probes into afterPack.
    const contents = path.join(appOutDir, packager.appInfo.productFilename + '.app/Contents');
    const resources = path.join(contents, 'Resources');
    const executable = path.join(contents, 'MacOS', selected.executable);
    require('node:child_process').execFileSync(
      executable,
      [path.join(root, 'scripts/desktop-image-probe.cjs'), resources],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 120_000 }
    );
    if (selected.bundled)
      await require('./node-package.cjs').verifyNodePackage({
        root,
        resources,
        executable,
        release: layout.release,
        electronVersion: packager.info.framework.version,
        target,
      });
    fs.mkdirSync(layout.reports, { recursive: true });
    fs.writeFileSync(
      path.join(layout.reports, 'image-probe.json'),
      JSON.stringify(
        { target, variant: selected.name, status: 'passed', phase: 'after-sign' },
        null,
        2
      ) + '\n'
    );
  },
  extraResources: [
    { from: runtime, to: `ffmpeg/${target}` },
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
  artifactName: selected.prefix + '-${version}-' + target + '.${ext}',
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
  dmg: { sign: false, format: 'UDZO' },
  publish: null,
};
