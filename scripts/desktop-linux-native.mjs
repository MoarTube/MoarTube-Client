import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLinuxDesktopArgs } from '../desktop/linux-variant.cjs';
const { arch, variants, dir } = parseLinuxDesktopArgs(process.argv.slice(2));
if (process.platform !== 'linux' || process.arch !== arch)
  throw new Error('Build on matching native Linux, or use the container build.');
const options = {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
  env: { ...process.env, MOARTUBE_DESKTOP_ARCH: arch },
};
const run = (args) => execFileSync(process.execPath, args, options);
run(['node_modules/tsup/dist/cli-default.js']);
run(['scripts/prepare-desktop-linux.mjs']);
if (variants.includes('bundled')) run(['scripts/prepare-desktop-node.mjs']);
for (const variant of variants) {
  run([
    'node_modules/electron-builder/out/cli/cli.js',
    '--config',
    variant === 'client'
      ? 'desktop/electron-builder-linux.cjs'
      : 'desktop/electron-builder-linux-bundled.cjs',
    '--linux',
    '--' + arch,
    ...(dir ? ['--dir'] : []),
    '--publish',
    'never',
  ]);
  if (!dir) {
    run(['scripts/verify-desktop-linux-package.mjs', '--variant=' + variant]);
    run(['scripts/desktop-checksums.mjs', '--linux', '--arch=' + arch, '--variant=' + variant]);
  }
}
