import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  run,
  inspectMachO,
  inspectDarwinDependencies,
} from '../../tooling/ffmpeg/scripts/darwin-native.mjs';
import { sha256 } from './desktop-ffmpeg.mjs';

export function verifyDarwinBundle(app, arch = 'x64') {
  const target = `darwin-${arch}`;
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
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
  const binaries = [
    path.join(contents, 'MacOS/MoarTube Client'),
    path.join(resources, 'runtime/node'),
  ];
  inspectDarwinDependencies(path.join(resources, 'runtime/node'), arch);
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
  const modules = path.join(resources, 'app.asar.unpacked/node_modules');
  const nativeModules = readdirSync(modules, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(node|dylib)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
  if (
    !nativeModules.some((file) => file.endsWith('.node')) ||
    !nativeModules.some((file) => file.includes('libvips'))
  )
    throw new Error('Packaged Sharp native dependencies missing');
  for (const file of [...binaries, ...nativeModules]) inspectMachO(file, arch);
  for (const file of binaries)
    if (!(statSync(file).mode & 0o111)) throw new Error(`Executable permissions missing: ${file}`);
  readFileSync(path.join(resources, 'runtime/LICENSE'));
  readFileSync(path.join(resources, `ffmpeg/${target}/SOURCES.txt`));
  const minimum = run(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :LSMinimumSystemVersion', path.join(contents, 'Info.plist')],
    { stdio: 'pipe' }
  ).trim();
  if (minimum !== '15.0') throw new Error(`Unexpected macOS deployment baseline: ${minimum}`);
  return {
    target,
    arch,
    buildId: manifest.buildId,
    binaryHashes: Object.fromEntries(
      Object.entries(manifest.files).map(([name, file]) => [name, file.sha256])
    ),
    nativeModules: nativeModules.map((file) => path.relative(app, file)),
    signature: 'ad-hoc',
    notarized: false,
  };
}
