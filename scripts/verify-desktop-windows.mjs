import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { windowsPaths, windowsVariant } from '../desktop/windows-variant.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const requested = process.argv[2] ?? 'all';
const variants = requested === 'all' ? ['client', 'bundled'] : [windowsVariant(requested).name];
for (const variant of variants) {
  const selected = windowsVariant(variant);
  const layout = windowsPaths(root, undefined, variant);
  execFileSync(
    process.execPath,
    [
      path.join(
        root,
        selected.bundled ? 'scripts/desktop-bundled-smoke.mjs' : 'scripts/desktop-smoke.mjs'
      ),
      path.join(layout.packages, 'win-unpacked', `${selected.productName}.exe`),
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true }
  );
  if (selected.bundled) {
    execFileSync(
      process.execPath,
      [
        path.join(root, 'scripts/desktop-share-smoke.mjs'),
        path.join(layout.packages, 'win-unpacked', `${selected.productName}.exe`),
      ],
      { cwd: root, stdio: 'inherit', windowsHide: true }
    );
  }
}
