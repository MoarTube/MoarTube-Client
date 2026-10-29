import { fileURLToPath } from 'node:url';
import { requireDarwinX64, run } from '../tooling/ffmpeg/scripts/darwin-native.mjs';

requireDarwinX64();
const cwd = fileURLToPath(new URL('../', import.meta.url));
run('npm', ['run', 'build'], { cwd });
run(process.execPath, ['scripts/prepare-desktop-darwin.mjs'], { cwd });
run(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--config',
    'desktop/electron-builder-darwin.cjs',
    '--mac',
    '--x64',
    '--publish',
    'never',
  ],
  { cwd }
);
run(process.execPath, ['scripts/verify-desktop-darwin-package.mjs'], { cwd });
run(process.execPath, ['scripts/desktop-checksums.mjs', '--darwin'], { cwd });
