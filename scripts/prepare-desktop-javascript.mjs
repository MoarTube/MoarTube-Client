import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { desktopPaths } from '../tooling/build-paths.cjs';
import { bundleDesktopJavaScript } from './lib/desktop-javascript.mjs';
import { consolidateDesktopNodeDependencies } from './lib/desktop-node-dependencies.mjs';
import { archiveDesktopNode } from './lib/desktop-node-archive.mjs';
import {
  createDesktopSourceArchive,
  addDesktopSourceNotes,
  nodeRuntimeFiles,
} from './lib/desktop-source.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Desktop JavaScript consolidation currently targets Windows x64.');
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const layout = desktopPaths(root, 'win32-x64', version);
const variant = process.argv.find((arg) => arg.startsWith('--variant='))?.split('=')[1] ?? 'all';
if (!['client', 'bundled', 'all'].includes(variant))
  throw new Error('Invalid desktop JavaScript variant');
const staging = path.resolve(layout.staging, 'javascript');
function reset(name) {
  const destination = path.resolve(staging, name);
  if (path.dirname(destination) !== staging || !['client', 'node', 'sources'].includes(name))
    throw new Error('Invalid desktop JavaScript staging directory');
  rmSync(destination, { recursive: true, force: true });
  return destination;
}
const reports = {};
reports.client = await bundleDesktopJavaScript({
  source: root,
  destination: reset('client'),
  entries: ['dist/desktop-backend.js'],
  copy: [
    'desktop/main.cjs',
    'desktop/autostart.cjs',
    'desktop/policy.cjs',
    'desktop/linux-processes.cjs',
    'desktop/bundled-node.cjs',
    'desktop/loading.html',
    'desktop/loading.js',
    'src/config/data-layout.cjs',
    'bin/check-node-version.js',
    'dist/public',
  ],
});
if (variant !== 'client') {
  reports.node = await bundleDesktopJavaScript({
    source: path.join(layout.staging, 'bundled/node'),
    destination: reset('node'),
    entries: ['dist/moartube-node.js', 'desktop-bootstrap.mjs', 'desktop-preflight.mjs'],
    copy: nodeRuntimeFiles,
  });
  reports.node.consolidation = await consolidateDesktopNodeDependencies(path.join(staging, 'node'));
  const bundle = JSON.parse(readFileSync(path.join(layout.staging, 'bundled/bundle.json'), 'utf8'));
  const ffmpeg = JSON.parse(readFileSync(layout.selection, 'utf8'));
  const runtimeFiles = Object.fromEntries(
    [
      [
        'app.asar.unpacked/dist/desktop-backend.js',
        path.join(staging, 'client/dist/desktop-backend.js'),
      ],
      ['node.asar/dist/moartube-node.js', path.join(staging, 'node/dist/moartube-node.js')],
      ['node.asar/desktop-bootstrap.mjs', path.join(staging, 'node/desktop-bootstrap.mjs')],
      ['node.asar/desktop-preflight.mjs', path.join(staging, 'node/desktop-preflight.mjs')],
    ].map(([name, file]) => [name, createHash('sha256').update(readFileSync(file)).digest('hex')])
  );
  const source = await createDesktopSourceArchive({
    root,
    nodeSource: path.join(layout.staging, 'bundled/node'),
    staging: reset('sources'),
    releaseDirectory: layout.release,
    version,
    releaseTag: ffmpeg.releaseTag,
    build: {
      ...bundle,
      clientVersion: version,
      runtimeFiles,
      ffmpeg: {
        buildId: ffmpeg.buildId,
        sourceArchive: ffmpeg.sourceArchive,
        sourceSha256: ffmpeg.sourceSha256,
        sourceUrl: ffmpeg.sourceUrl,
      },
    },
  });
  writeFileSync(
    path.join(staging, 'node/SOURCES.txt'),
    `Matching source and build materials for MoarTube Client + Node ${version}\n\n` +
      `Download from the same release as this application:\n${source.url}\n\n` +
      `Archive: ${source.archive}\nSHA256: ${source.sha256}\n\n` +
      'Source files are not needed to run the application. Licenses and third-party notices remain included.\n'
  );
  writeFileSync(
    path.join(staging, 'bundle.json'),
    JSON.stringify({ ...bundle, applicationSource: source }, null, 2) + '\n'
  );
  reports.node.archive = await archiveDesktopNode(path.join(staging, 'node'));
  mkdirSync(layout.state, { recursive: true });
  writeFileSync(
    path.join(layout.state, 'node-source.json'),
    JSON.stringify(source, null, 2) + '\n'
  );
  addDesktopSourceNotes(path.join(layout.release, 'RELEASE-NOTES-windows-bundled.md'), source);
  if (variant === 'all')
    addDesktopSourceNotes(path.join(layout.release, 'RELEASE-NOTES.md'), source);
  reports.node.source = source;
}
mkdirSync(layout.reports, { recursive: true });
writeFileSync(
  path.join(layout.reports, 'javascript-bundles.json'),
  JSON.stringify(reports, null, 2) + '\n'
);
console.log('Desktop JavaScript consolidated:', reports);
