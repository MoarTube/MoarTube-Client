// Maintenance helper: regenerate deliberately with an explicit reference binary.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) throw new Error('Pass the reference ffmpeg executable path');
const reference = path.resolve(process.argv[2]);
const directory = fileURLToPath(new URL('fixtures/', import.meta.url));
mkdirSync(directory, { recursive: true });
const fixtures = [];
for (const [file, codec, bitDepth, options] of [
  ['av1-8bit.ivf', 'av1', 8, ['-c:v', 'libaom-av1', '-cpu-used', '8', '-crf', '50', '-pix_fmt', 'yuv420p']],
  ['av1-10bit.ivf', 'av1', 10, ['-c:v', 'libaom-av1', '-cpu-used', '8', '-crf', '50', '-pix_fmt', 'yuv420p10le']],
  ['hevc-8bit.hevc', 'hevc', 8, ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p']],
]) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=10', '-frames:v', '3', ...options, path.join(directory, file)];
  execFileSync(reference, args, { windowsHide: true, timeout: 60000 });
  fixtures.push({ file, codec, bitDepth, width: 128, height: 72, frames: 3, source: 'synthetic FFmpeg testsrc2', arguments: args.slice(0, -1).concat(file), sha256: createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex') });
}
const referenceVersion = execFileSync(reference, ['-version'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0];
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ referenceVersion, fixtures }, null, 2) + '\n');
