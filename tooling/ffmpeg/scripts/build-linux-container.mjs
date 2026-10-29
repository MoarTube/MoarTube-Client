import { mkdirSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.platform !== 'linux')
  throw new Error('Run this entry point inside the Linux FFmpeg build container.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
mkdirSync(path.join(root, 'build/ffmpeg/cache'), { recursive: true });
symlinkSync('/inputs', path.join(root, 'build/ffmpeg/cache/sources'));
execFileSync(process.execPath, ['tooling/ffmpeg/scripts/build-linux-native.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
