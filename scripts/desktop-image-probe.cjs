const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

async function main() {
  const resources = path.resolve(process.argv[2]);
  const app = path.join(resources, 'app.asar.unpacked');
  const runtime = path.join(app, 'dist/image-runtime');
  const { renderImages, stopImages } = require(path.join(runtime, 'client.cjs'));
  const { inspectInput } = require(path.join(runtime, 'input.cjs'));
  const requireApp = createRequire(path.join(app, 'package.json'));
  const { initializeImageMagick, ImageMagick, MagickColor, MagickFormat, ColorProfile } =
    requireApp('@imagemagick/magick-wasm');
  try {
    await initializeImageMagick(
      fs.readFileSync(requireApp.resolve('@imagemagick/magick-wasm/magick.wasm'))
    );
    const source = ImageMagick.read(new MagickColor('#c10087'), 64, 48, (image) => {
      image.setProfile(new ColorProfile(fs.readFileSync(path.join(runtime, 'profiles/srgb.icc'))));
      return image.write(MagickFormat.Png, (data) => Buffer.from(data));
    });
    assert.equal(inspectInput(source).normalize, true, 'Probe must exercise the WASM worker');
    const target = `${process.platform}-${process.arch}`;
    const directory = path.join(resources, 'ffmpeg', target);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
    const outputs = [
      { width: 48, height: 48, format: 'png' },
      { width: 128, height: 128, format: 'png' },
      { width: 2560, height: 424, format: 'png' },
      { width: 100, height: 100, format: 'jpeg' },
      { width: 512, height: 288, format: 'jpeg' },
      { width: 1280, height: 720, format: 'jpeg' },
    ];
    const result = await renderImages(source, outputs, {
      ffmpegPath: path.join(directory, manifest.files.ffmpeg.path),
    });
    for (const [i, output] of outputs.entries()) {
      const metadata = inspectInput(result[i]);
      assert.equal(metadata.width, output.width);
      assert.equal(metadata.height, output.height);
      assert.equal(metadata.format, output.format);
    }
    await assert.rejects(
      renderImages(Buffer.from('invalid'), outputs, {
        ffmpegPath: path.join(directory, manifest.files.ffmpeg.path),
      })
    );
    console.log(
      JSON.stringify({
        target,
        imagePipeline: 'WASM worker + FFmpeg',
        presets: 6,
        result: 'passed',
      })
    );
  } finally {
    await stopImages();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
