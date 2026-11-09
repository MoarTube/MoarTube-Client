import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const windowsCommandFiles = [
  'src/utils/gpu-encoding.ts',
  'src/utils/live-hls.ts',
  'src/utils/ffmpeg-path.ts',
  'src/utils/ffmpeg-artifact.ts',
  'src/services/ffmpeg.ts',
  'src/services/video-publish.ts',
  'src/services/live-stream.ts',
  'src/utils/hardware.ts',
  'src/utils/windows-gpus.ts',
  'tests/gpu-hardware.test.ts',
  'tests/windows-live-hardware.test.ts',
  'tests/integration/gpu-policy.ts',
];
export function recipeHash(root, target) {
  const tooling = path.join(root, 'tooling/ffmpeg');
  const hash = createHash('sha256');
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (!/\.md$/i.test(entry.name)) files.push(file);
    }
  }
  visit(tooling);
  if (target === 'win32-x64') {
    files.push(
      path.join(root, 'tooling/build-paths.cjs'),
      ...windowsCommandFiles.map((name) => path.join(root, name))
    );
    for (const file of files.sort())
      hash
        .update(path.relative(root, file).replaceAll('\\', '/') + '\0')
        .update(readFileSync(file))
        .update('\0');
  } else {
    for (const file of files)
      hash
        .update(
          path.relative(target.startsWith('linux') ? tooling : root, file).replaceAll('\\', '/')
        )
        .update('\0')
        .update(readFileSync(file))
        .update('\0');
    hash.update(readFileSync(path.join(root, 'tooling/build-paths.cjs')));
  }
  return hash.digest('hex');
}
