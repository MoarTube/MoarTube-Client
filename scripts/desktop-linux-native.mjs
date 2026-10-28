import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linuxTarget } from '../tooling/ffmpeg/scripts/linux-target.mjs';

const { arch } = linuxTarget(process.env.MOARTUBE_DESKTOP_ARCH ?? process.arch);
if (process.platform !== 'linux' || process.arch !== arch)
  throw new Error(
    'Build on Linux matching the target architecture; use the Docker build from Windows.'
  );
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--dir'))
  throw new Error('Usage: desktop-linux-native.mjs [--dir]');
const options = {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
  env: { ...process.env, MOARTUBE_DESKTOP_ARCH: arch },
};
execFileSync('npm', ['run', 'build'], options);
execFileSync(process.execPath, ['scripts/prepare-desktop-linux.mjs'], options);
execFileSync(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--config',
    'desktop/electron-builder-linux.cjs',
    '--linux',
    `--${arch}`,
    ...args,
    '--publish',
    'never',
  ],
  options
);
if (!args.includes('--dir')) {
  execFileSync(process.execPath, ['scripts/verify-desktop-linux-package.mjs'], options);
  execFileSync(
    process.execPath,
    ['scripts/desktop-checksums.mjs', '--linux', `--arch=${arch}`],
    options
  );
}
