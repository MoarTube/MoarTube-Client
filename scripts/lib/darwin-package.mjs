import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { extractFile, statFile, listPackage } from '@electron/asar';
import { darwinVariant } from '../../desktop/darwin-variant.cjs';
import { desktopPaths } from '../../tooling/build-paths.cjs';
import { verifyNodePackage } from '../../desktop/node-package.cjs';
import {
  run,
  inspectMachO,
  inspectDarwinDependencies,
} from '../../tooling/ffmpeg/scripts/darwin-native.mjs';
import { sha256 } from './desktop-ffmpeg.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

export async function verifyDarwinBundle(app, arch = 'x64', variant = 'client') {
  const selected = darwinVariant(variant);
  const target = `darwin-${arch}`;
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  const metadata = JSON.parse(extractFile(path.join(resources, 'app.asar'), 'package.json'));
  if ((metadata.moartubeBundledNode === true) !== selected.bundled)
    throw new Error('Packaged Darwin application variant does not match the requested build');
  if (existsSync(path.join(resources, 'node.asar')) !== selected.bundled)
    throw new Error('Packaged Darwin Node resources do not match the application variant');
  if (existsSync(path.join(resources, 'runtime')) || existsSync(path.join(resources, 'node')))
    throw new Error('Standalone Node runtime or loose Node source tree in Darwin application');
  if (statFile(path.join(resources, 'app.asar'), 'node_modules/fastify/fastify.js').unpacked)
    throw new Error('Client JavaScript dependencies must stay in ASAR');
  if (
    !statSync(
      path.join(
        resources,
        'app.asar.unpacked/node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm'
      )
    ).size
  )
    throw new Error('Packaged image WASM asset missing');
  if (
    listPackage(path.join(resources, 'app.asar')).some((name) =>
      /node_modules\/(?:sharp|@janhapke\/sharp-electron|@img\/sharp)/.test(name)
    )
  )
    throw new Error('Obsolete Sharp dependency included in Darwin package');
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const manifest = JSON.parse(
    readFileSync(path.join(resources, `ffmpeg/${target}/manifest.json`), 'utf8')
  );
  if (
    manifest.target !== target ||
    manifest.schemaVersion !== 1 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.buildId)
  )
    throw new Error('Invalid packaged Darwin FFmpeg manifest');
  const executable = path.join(contents, 'MacOS', selected.executable);
  const binaries = [executable];
  for (const name of ['ffmpeg', 'ffprobe']) {
    const file = manifest.files[name];
    if (file.path !== `${manifest.buildId}/${name}`)
      throw new Error('Invalid packaged FFmpeg path');
    const executable = path.join(resources, `ffmpeg/${target}`, file.path);
    if (sha256(executable) !== file.sha256)
      throw new Error(`Packaged ${name} differs from its verified candidate`);
    inspectDarwinDependencies(executable, arch);
    run(executable, ['-version'], { stdio: 'pipe' });
    binaries.push(executable);
  }
  const moduleDirectories = [
    path.join(resources, 'app.asar.unpacked/node_modules'),
    ...(selected.bundled ? [path.join(resources, 'node.asar.unpacked/node_modules')] : []),
  ];
  const nativeModules = moduleDirectories.flatMap((modules) =>
    readdirSync(modules, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(node|dylib)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
  );
  let node;
  if (selected.bundled) {
    node = await verifyNodePackage({
      root,
      resources,
      executable,
      release: desktopPaths(root, target, metadata.version).release,
      electronVersion: require('electron/package.json').version,
      target,
    });
    const cloudflared = path.join(
      resources,
      `node.asar.unpacked/resources/cloudflared/${target}/cloudflared`
    );
    inspectDarwinDependencies(cloudflared, arch);
    binaries.push(cloudflared);
    extractFile(path.join(resources, 'node.asar'), 'LICENSE.md');
    readFileSync(path.join(resources, 'node.asar.unpacked/resources/cloudflared/LICENSE'));
    readFileSync(path.join(resources, 'node-SOURCES.txt'));
  }
  for (const file of [...binaries, ...nativeModules]) inspectMachO(file, arch);
  for (const file of binaries)
    if (!(statSync(file).mode & 0o111)) throw new Error(`Executable permissions missing: ${file}`);
  readFileSync(path.join(resources, `ffmpeg/${target}/SOURCES.txt`));
  const minimum = run(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :LSMinimumSystemVersion', path.join(contents, 'Info.plist')],
    { stdio: 'pipe' }
  ).trim();
  if (minimum !== '15.0') throw new Error(`Unexpected macOS deployment baseline: ${minimum}`);
  const entries = readdirSync(app, { recursive: true, withFileTypes: true });
  return {
    target,
    arch,
    variant,
    node,
    runtimeHost: 'electron',
    fileCounts: {
      regularFiles: entries.filter((entry) => entry.isFile()).length,
      symbolicLinks: entries.filter((entry) => entry.isSymbolicLink()).length,
      appAsarEntries: listPackage(path.join(resources, 'app.asar')).length,
      nodeAsarEntries: selected.bundled ? listPackage(path.join(resources, 'node.asar')).length : 0,
    },
    buildId: manifest.buildId,
    binaryHashes: Object.fromEntries(
      Object.entries(manifest.files).map(([name, file]) => [name, file.sha256])
    ),
    nativeModules: nativeModules.map((file) => path.relative(app, file)),
    signature: 'ad-hoc',
    notarized: false,
  };
}
