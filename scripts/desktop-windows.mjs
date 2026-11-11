import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { windowsVariant } from '../desktop/windows-variant.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--dir' && !arg.startsWith('--variant=')))
  throw new Error('Usage: desktop-windows.mjs [--variant=all|client|bundled] [--dir]');
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Windows desktop builds require Windows x64');
const variant = args.find((arg) => arg.startsWith('--variant='))?.split('=')[1] ?? 'all';
const variants = variant === 'all' ? ['client', 'bundled'] : [windowsVariant(variant).name];
const require = createRequire(import.meta.url);
const run = (file, args = []) =>
  execFileSync(process.execPath, [file, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
run(require.resolve('tsup/dist/cli-default.js'));
run(path.join(root, 'scripts/prepare-desktop.mjs'), [`--variant=${variant}`]);
if (variants.includes('bundled')) run(path.join(root, 'scripts/prepare-desktop-node.mjs'));
run(path.join(root, 'scripts/prepare-desktop-javascript.mjs'), [`--variant=${variant}`]);
for (const selected of variants) {
  run(require.resolve('electron-builder/out/cli/cli.js'), [
    '--config',
    selected === 'bundled'
      ? 'desktop/electron-builder.cjs'
      : 'desktop/electron-builder-client.cjs',
    '--win',
    '--x64',
    ...(args.includes('--dir') ? ['--dir'] : []),
    '--publish',
    'never',
  ]);
  if (!args.includes('--dir'))
    run(path.join(root, 'scripts/desktop-checksums.mjs'), [
      `--windows-variant=${selected}`,
      ...(variant === 'all' && selected === 'bundled' ? ['--all-windows-variants'] : []),
    ]);
}
