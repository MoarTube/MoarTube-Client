import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { windowsPaths, windowsVariant } from '../desktop/windows-variant.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [requested = 'all', executablePath, ...extra] = process.argv.slice(2);
if (extra.length || (requested === 'all' && executablePath))
  throw new Error('Usage: verify-desktop-windows.mjs [all|client|bundled] [executable]');
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Windows desktop verification requires Windows x64.');
const variants = requested === 'all' ? ['client', 'bundled'] : [windowsVariant(requested).name];
for (const variant of variants) {
  const selected = windowsVariant(variant);
  const layout = windowsPaths(root, undefined, variant);
  const executable = executablePath
    ? path.resolve(root, executablePath)
    : path.join(layout.packages, 'win-unpacked', `${selected.productName}.exe`);
  if (!existsSync(executable))
    throw new Error(
      `Packaged application missing: ${executable}. Run npm run desktop:pack:windows:${selected.bundled ? 'client-node' : 'client'} or the corresponding build command first.`
    );
  execFileSync(
    process.execPath,
    [
      path.join(
        root,
        selected.bundled ? 'scripts/desktop-bundled-smoke.mjs' : 'scripts/desktop-smoke.mjs'
      ),
      executable,
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true }
  );
  if (selected.bundled) {
    execFileSync(
      process.execPath,
      [path.join(root, 'scripts/desktop-share-smoke.mjs'), executable],
      { cwd: root, stdio: 'inherit', windowsHide: true }
    );
  }
}
