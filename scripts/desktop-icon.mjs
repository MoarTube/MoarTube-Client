import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const svg = readFileSync(path.join(root, 'desktop/icon.svg'));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(
  sizes.map((size) => sharp(svg).resize(size, size).png().toBuffer())
);
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + 16 * index;
  header[entry] = sizes[index] === 256 ? 0 : sizes[index];
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
mkdirSync(path.join(root, 'build/desktop/assets'), { recursive: true });
writeFileSync(path.join(root, 'build/desktop/assets/icon.ico'), Buffer.concat([header, ...frames]));
await sharp(svg).resize(512, 512).png().toFile(path.join(root, 'build/desktop/assets/icon.png'));
