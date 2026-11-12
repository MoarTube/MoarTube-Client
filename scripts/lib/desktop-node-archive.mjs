import { createPackageWithOptions, statFile } from '@electron/asar';
import path from 'node:path';
import { existsSync, rmSync } from 'node:fs';

export async function archiveDesktopNode(
  directory,
  target = `${process.platform}-${process.arch}`
) {
  if (!['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].includes(target))
    throw new Error('Unsupported Node archive target');
  directory = path.resolve(directory);
  const archive = directory + '.asar';
  const unpacked = archive + '.unpacked';
  if (path.dirname(unpacked) !== path.dirname(directory) || path.basename(directory) !== 'node')
    throw new Error('Invalid Node archive staging directory');
  rmSync(archive, { force: true });
  rmSync(unpacked, { recursive: true, force: true });
  await createPackageWithOptions(directory, archive, {
    // ASAR's API matches absolute paths. Native addons, external executables,
    // worker entry points and public assets need real filesystem paths.
    unpack:
      '**/{dist/public/**/*,resources/cloudflared/**/*,node_modules/**/*.node,node_modules/**/*.dll,node_modules/**/*.dylib,node_modules/**/*.so*,node_modules/thread-stream/lib/worker.js,node_modules/pino/lib/worker.js}',
  });
  for (const name of ['dist/moartube-node.js', 'desktop-bootstrap.mjs', 'desktop-preflight.mjs'])
    if (statFile(archive, path.normalize(name)).unpacked)
      throw new Error(`Node JavaScript must stay inside ASAR: ${name}`);
  for (const name of [
    `node_modules/better-sqlite3/prebuilds/${target}.node`,
    `resources/cloudflared/${target}/cloudflared${target.startsWith('win32') ? '.exe' : ''}`,
  ])
    if (!statFile(archive, path.normalize(name)).unpacked || !existsSync(path.join(unpacked, name)))
      throw new Error(`Missing unpacked Node binary: ${name}`);
  return archive;
}
