import { chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLinuxTarget } from './linux-target.mjs';
import { ffmpegPaths } from '../../build-paths.cjs';

const { arch, target } = parseLinuxTarget(process.argv.slice(2));
if (process.platform !== 'linux' || process.arch !== arch)
  throw new Error('Run runtime checks in a Linux container matching the target architecture.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const layout = ffmpegPaths(root, target);
const binaries = ['ffmpeg', 'ffprobe'].map((name) => path.join(layout.install, 'bin', name));
for (const binary of binaries) chmodSync(binary, 0o755);
const options = { cwd: root, stdio: 'inherit' };
execFileSync(
  process.execPath,
  ['tooling/ffmpeg/scripts/verify-features.mjs', ...binaries, '/reports/features', target],
  options
);
execFileSync(
  process.execPath,
  ['tooling/ffmpeg/scripts/verify-software.mjs', ...binaries, '/reports/software'],
  options
);
