import { createHash } from 'node:crypto';
import { archive as writeBuilderArchive } from 'app-builder-lib/out/targets/archive.js';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const clientSourceFiles = [
  'src',
  'public',
  'bin',
  'scripts',
  'desktop',
  'tooling',
  'node_modules/sharp',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsup.config.ts',
  'LICENSE.md',
  'README.md',
];
export const nodeSourceFiles = [
  'src',
  'public',
  'drizzle',
  'bin',
  'scripts',
  'node_modules',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsup.config.ts',
  'LICENSE.md',
  'resources/cloudflared/LICENSE',
  'resources/cloudflared/README.md',
];
export const nodeRuntimeFiles = [
  'bin/check-node-version.js',
  'resources',
  'LICENSE.md',
  'dist/public',
  'dist/drizzle',
];

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export async function createDesktopSourceArchive({
  root,
  nodeSource,
  staging,
  releaseDirectory,
  version,
  releaseTag,
  build,
  writeArchive = (file, directory) =>
    writeBuilderArchive('zip', file, directory, { withoutDir: true, compression: 'normal' }),
}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version))
    throw new Error('Invalid source archive version');
  mkdirSync(staging, { recursive: true });
  for (const [component, source, files] of [
    ['client', root, clientSourceFiles],
    ['node', nodeSource, nodeSourceFiles],
  ]) {
    for (const name of files) {
      const from = path.join(source, name);
      cpSync(from, path.join(staging, component, name), {
        recursive: true,
        preserveTimestamps: true,
        filter(file) {
          const relative = path.relative(source, file);
          if (relative.split(path.sep).some((part) => ['.git', '.bin'].includes(part)))
            return false;
          if (/\.(exe|dll|node|obj|o)$/i.test(file)) return false;
          if (lstatSync(file).isSymbolicLink())
            throw new Error(`Unexpected source symlink: ${file}`);
          return true;
        },
      });
    }
  }
  writeFileSync(path.join(staging, 'BUILD.json'), JSON.stringify(build, null, 2) + '\n');
  writeFileSync(
    path.join(staging, 'README.txt'),
    'Matching source and build materials for the Windows MoarTube Client + Node release.\n\n' +
      'client/ contains the desktop application source and packaging recipes.\n' +
      'node/ contains the original Node source, package manifest, lockfile, build scripts, assets and production dependency sources.\n' +
      'Compiled executables, native addons and private application data are excluded.\n' +
      'BUILD.json identifies the runtime versions and matching FFmpeg source download. SOURCE-MANIFEST.json lists source file hashes.\n\n' +
      'Rebuild on Windows x64 with the Node.js version recorded in BUILD.json.\n' +
      'Run npm ci and npm run install:cloudflared in node/; npm ci replaces the source-only dependency tree and installs the Node-API SQLite binary.\n' +
      'Run npm ci in client/. Follow client/README.md and the included FFmpeg recipes to rebuild/stage the matching FFmpeg runtime.\n' +
      'From client/, set MOARTUBE_NODE_SOURCE to the absolute node/ directory, then run npm run desktop:build:windows:client-node.\n' +
      'The Windows bundle runs both backends through Electron. Node JavaScript is stored in node.asar; native binaries, logging workers and public assets are unpacked during installation. No standalone Node executable is distributed.\n' +
      'Dependency/tool downloads need network access. These source materials are not needed to install or run the application.\n'
  );
  const entries = [];
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en')
    )) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else
        entries.push({
          path: path.relative(staging, file).replaceAll('\\', '/'),
          sha256: digest(file),
        });
    }
  }
  walk(staging);
  writeFileSync(
    path.join(staging, 'SOURCE-MANIFEST.json'),
    JSON.stringify({ schemaVersion: 1, files: entries }, null, 2) + '\n'
  );
  mkdirSync(releaseDirectory, { recursive: true });
  const partial = path.join(releaseDirectory, `node-sources.partial-${process.pid}.zip`);
  await writeArchive(partial, staging);
  const sha256 = digest(partial);
  const archive = `MoarTube-Client-Node-${version}-windows-x64-${sha256.slice(0, 12)}-sources.zip`;
  const output = path.join(releaseDirectory, archive);
  renameSync(partial, output);
  return {
    schemaVersion: 1,
    clientVersion: version,
    nodeVersion: build.nodeVersion,
    archive,
    sha256,
    url: `https://github.com/MoarTube/MoarTube-Client/releases/download/${encodeURIComponent(releaseTag)}/${archive}`,
    releaseTag,
    runtimeFiles: build.runtimeFiles,
  };
}

export function addDesktopSourceNotes(file, source) {
  if (!existsSync(file)) return;
  const block =
    '<!-- bundled-node-sources:start -->\n' +
    `- [Client + Node matching source and build materials](${source.url})\n` +
    `- Source archive SHA-256: \`${source.sha256}\`\n\n` +
    'Upload this source archive alongside the Client + Node downloads and retain it while distributing them. Sources are a separate optional download; the installer contains runtime files and license notices.\n' +
    '<!-- bundled-node-sources:end -->';
  const text = readFileSync(file, 'utf8').replace(
    /\n*<!-- bundled-node-sources:start -->[\s\S]*?<!-- bundled-node-sources:end -->\n*/g,
    '\n'
  );
  writeFileSync(file, text.trimEnd() + '\n\n' + block + '\n');
}
