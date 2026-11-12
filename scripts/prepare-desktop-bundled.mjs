import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const options = {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
  windowsHide: true,
};
if (!['win32', 'linux', 'darwin'].includes(process.platform))
  throw new Error('Client + Node supports Windows, Linux and macOS.');
execFileSync(
  process.execPath,
  process.platform === 'win32'
    ? ['scripts/prepare-desktop.mjs', '--variant=bundled']
    : process.platform === 'darwin'
      ? ['scripts/prepare-desktop-darwin.mjs', `--arch=${process.arch}`]
      : ['scripts/prepare-desktop-linux.mjs'],
  options
);
execFileSync(process.execPath, ['scripts/prepare-desktop-node.mjs'], options);
