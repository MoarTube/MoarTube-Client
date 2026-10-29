import { fileURLToPath } from 'node:url';
import { requireDarwinTarget, run } from '../tooling/ffmpeg/scripts/darwin-native.mjs';

const { arch } = requireDarwinTarget();
const archArgs = [`--arch=${arch}`];
const cwd = fileURLToPath(new URL('../', import.meta.url));
run('npm', ['run', 'build'], { cwd });
run(process.execPath, ['scripts/prepare-desktop-darwin.mjs', ...archArgs], { cwd });
run(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--config',
    'desktop/electron-builder-darwin.cjs',
    '--mac',
    `--${arch}`,
    '--publish',
    'never',
  ],
  { cwd }
);
run(process.execPath, ['scripts/verify-desktop-darwin-package.mjs', ...archArgs], { cwd });
run(process.execPath, ['scripts/desktop-checksums.mjs', '--darwin', ...archArgs], { cwd });
