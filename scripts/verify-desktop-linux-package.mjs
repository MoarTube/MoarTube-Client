import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linuxPaths, linuxVariant, parseLinuxDesktopArgs } from '../desktop/linux-variant.cjs';
import { linuxTarget } from '../tooling/ffmpeg/scripts/linux-target.mjs';
import { assertLinuxElf } from '../tooling/ffmpeg/scripts/linux-elf.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { arch, target } = linuxTarget(process.env.MOARTUBE_DESKTOP_ARCH ?? process.arch);
if (process.platform !== 'linux' || process.arch !== arch)
  throw new Error('Inspect on the matching Linux architecture.');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const { variant } = parseLinuxDesktopArgs(process.argv.slice(2), 'client');
const selected = linuxVariant(variant);
const layout = linuxPaths(root, arch, version, variant);
const unpacked = path.join(
  layout.packages,
  arch === 'x64' ? 'linux-unpacked' : 'linux-arm64-unpacked'
);
const resources = path.join(unpacked, 'resources');
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const selection = read(layout.selection);
const runtime = path.join(resources, 'ffmpeg', target);
const manifest = read(path.join(runtime, 'manifest.json'));
if (manifest.target !== target || manifest.buildId !== selection.buildId)
  throw new Error('Packaged FFmpeg target/identity mismatch');
const binaries = {};
for (const [name, file] of [
  ['electron', path.join(unpacked, selected.executable)],
  ['node', path.join(resources, 'runtime/node')],
  ...['ffmpeg', 'ffprobe'].map((name) => [name, path.join(runtime, manifest.files[name].path)]),
]) {
  assertLinuxElf(readFileSync(file), arch);
  if (!(statSync(file).mode & 0o111)) throw new Error(`Not executable: ${name}`);
  binaries[name] = digest(file);
  if (['ffmpeg', 'ffprobe'].includes(name) && binaries[name] !== manifest.files[name].sha256)
    throw new Error(`Packaged checksum mismatch: ${name}`);
}
if (!statSync(path.join(resources, 'runtime/LICENSE')).size)
  throw new Error('Bundled Node license missing');
const nativeLibraries = [];
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (entry.isFile() && /\.node$|\.so(?:\.|$)/.test(entry.name)) {
      assertLinuxElf(readFileSync(file), arch);
      nativeLibraries.push(path.relative(unpacked, file));
    }
  }
}
inspect(path.join(resources, 'app.asar.unpacked'));
if (!nativeLibraries.some((file) => file.endsWith('.node') && file.includes('sharp')))
  throw new Error('Packaged Sharp native module missing');
if (selected.bundled) {
  inspect(path.join(resources, 'node/node_modules'));
  const nodeRequire = path.join(resources, 'node/package.json');
  execFileSync(
    path.join(resources, 'runtime/node'),
    [
      '--input-type=commonjs',
      '-e',
      "const Database=require('better-sqlite3');const db=new Database(':memory:');db.exec('create table probe(id)');db.close()",
    ],
    { cwd: path.dirname(nodeRequire) }
  );
  const tunnel = path.join(resources, 'node/resources/cloudflared', target, 'cloudflared');
  assertLinuxElf(readFileSync(tunnel), arch);
  if (!(statSync(tunnel).mode & 0o111)) throw new Error('Cloudflared is not executable');
}
const deb = path.join(layout.packages, `${selected.prefix}-${version}-${target}.deb`);
const debArchitecture = execFileSync('dpkg-deb', ['--field', deb, 'Architecture'], {
  encoding: 'utf8',
}).trim();
if (debArchitecture !== (arch === 'arm64' ? 'arm64' : 'amd64'))
  throw new Error('DEB architecture mismatch');
execFileSync('dpkg-deb', ['--fsys-tarfile', deb], { stdio: 'ignore' });
execFileSync(
  'gzip',
  ['--test', path.join(layout.packages, `${selected.prefix}-${version}-${target}-portable.tar.gz`)],
  { stdio: 'inherit' }
);
mkdirSync(layout.reports, { recursive: true });
writeFileSync(
  path.join(layout.reports, 'package.json'),
  JSON.stringify(
    {
      target,
      debArchitecture,
      binaries,
      ffmpegBuildId: manifest.buildId,
      nativeLibraries,
      archiveIntegrity: 'passed',
    },
    null,
    2
  ) + '\n'
);
console.log(`${target}: Electron, Sharp, FFmpeg, DEB architecture and archive integrity verified.`);
