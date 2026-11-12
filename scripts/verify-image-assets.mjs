import fs from 'node:fs';
import { createHash } from 'node:crypto';
const profiles = new URL('../src/utils/image-runtime/profiles/', import.meta.url);
for (const [file, expected] of [
  ['srgb.icc', 'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353'],
  ['cmyk.icc', '156e7c14f244cfc4ed83a755ca4803d80e15dd249b40fae82cb127d3902e15c7'],
]) {
  if (
    createHash('sha256')
      .update(fs.readFileSync(new URL(file, profiles)))
      .digest('hex') !== expected
  )
    throw new Error(`Image profile hash mismatch: ${file}`);
}
console.log('Pinned image colour profiles verified.');
