import magick from '../src/utils/image-runtime/magick.cjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
// Rasterize the vector at the largest output size before downsampling ICO frames.
const svg = readFileSync(path.join(root, 'desktop/icon.svg'), 'utf8').replace(
  '<svg ',
  '<svg width="512" height="512" '
);
const { ImageMagick, MagickFormat, MagickReadSettings, MagickColor, CompositeOperator } = magick;
await magick.initialize();
// MSVG loses the SVG paint-server gradient. Render its silhouette and arrows
// separately, then apply the native gradient using the source SVG's colours.
const colours = [...svg.matchAll(/stop-color="([^"]+)"/g)].map((match) => match[1]);
if (colours.length !== 2) throw new Error('Expected two brand gradient colours');
const silhouette = Buffer.from(svg.replace('fill="url(#brand)"', 'fill="white"'));
const arrows = Buffer.from(svg.replace('fill="url(#brand)"', 'fill="none"'));
const svgSettings = new MagickReadSettings({
  format: MagickFormat.Msvg,
  backgroundColor: new MagickColor('transparent'),
});
const gradientSettings = new MagickReadSettings({ width: 512, height: 512 });
// Match the gradient to the SVG rectangle, at 2x resolution, from (16, 16) to (496, 496).
gradientSettings.setDefine(MagickFormat.Gradient, 'vector', '16,16 496,496');
function icon(size) {
  return ImageMagick.read('gradient:' + colours.join('-'), gradientSettings, (image) => {
    ImageMagick.read(silhouette, svgSettings, (mask) => {
      image.composite(mask, CompositeOperator.CopyAlpha);
    });
    ImageMagick.read(arrows, svgSettings, (foreground) =>
      image.composite(foreground, CompositeOperator.Over)
    );
    image.resize(size, size);
    return image.write(MagickFormat.Png, (data) => Buffer.from(data));
  });
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map((size) => icon(size)));
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
writeFileSync(path.join(root, 'build/desktop/assets/icon.png'), icon(512));
