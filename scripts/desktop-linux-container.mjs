import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux')
  throw new Error('Run this entry point inside the Linux desktop build container.');
const options = { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' };
if (process.env.MOARTUBE_DEPENDENCIES_PREPARED !== '1') {
  execFileSync(
    'npm',
    ['ci', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund'],
    options
  );
  execFileSync(process.execPath, ['node_modules/electron/install.js'], options);
  execFileSync(process.execPath, ['scripts/prefetch-desktop-tools.mjs'], options);
}
execFileSync('npm', ['run', 'desktop:test'], options);
execFileSync('npm', ['run', 'desktop:build:linux:native'], options);
