const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { dimensions, inspectInput, MAX_BYTES } = require('./input.cjs');
const {
  initialize,
  ImageMagick,
  MagickImageInfo,
  MagickReadSettings,
  ColorProfile,
  ColorSpace,
  RenderingIntent,
  MagickFormat,
  ResourceLimits,
} = require('./magick.cjs');

const ready = (async () => {
  await initialize();
  ResourceLimits.width = 40_000_000n;
  ResourceLimits.height = 40_000_000n;
  ResourceLimits.memory = 384n * 1024n ** 2n;
  ResourceLimits.maxMemoryRequest = 384n * 1024n ** 2n;
  ResourceLimits.disk = 0n;
  // ICC transformations create temporary images internally; frameCount still
  // restricts decoded input to the first frame/page.
  ResourceLimits.listLength = 8n;
  ResourceLimits.maxProfileSize = 8n * 1024n ** 2n;
  // The parent enforces a per-operation wall-clock deadline by terminating
  // this worker; do not impose a cumulative lifetime on a persistent runtime.
  return {
    srgb: new ColorProfile(fs.readFileSync(path.join(__dirname, 'profiles/srgb.icc'))),
    cmyk: new ColorProfile(fs.readFileSync(path.join(__dirname, 'profiles/cmyk.icc'))),
  };
})();
// Prevent a failed lazy initialization from becoming an unhandled rejection.
ready.catch(() => {});
parentPort.on('message', async ({ id, input }) => {
  try {
    const profiles = await ready;
    let data = Buffer.from(input);
    if (data[0] === 0x1f && data[1] === 0x8b)
      data = gunzipSync(data, { maxOutputLength: MAX_BYTES });
    const header = inspectInput(data);
    // Use the internal SVG renderer, never a host Inkscape delegate.
    const settings = new MagickReadSettings({
      frameIndex: 0,
      frameCount: 1,
      ...(header.format === 'svg' ? { format: MagickFormat.Msvg } : {}),
    });
    const info = MagickImageInfo.create(data, settings);
    if (
      !/^(?:JPEG|JPG|JPE|PNG\d*|WEBP|GIF\d*|BMP\d*|TIFF\d*|AVIF|HEIC|HEIF|MSVG|SVGZ?)$/.test(
        info.format
      )
    )
      throw new Error('Unsupported image format');
    dimensions(info.width, info.height);
    const result = ImageMagick.read(data, settings, (image) => {
      dimensions(image.width, image.height);
      const embedded = image.getColorProfile();
      if (header.hasProfile && !embedded) throw new Error('Invalid embedded ICC profile');
      const cmyk = image.colorSpace === ColorSpace.CMYK;
      if (embedded && embedded.colorSpace !== image.colorSpace)
        throw new Error('Embedded ICC profile does not match the image colour space');
      image.renderingIntent = RenderingIntent.Perceptual;
      image.blackPointCompensation = false;
      const converted = embedded
        ? image.transformColorSpace(profiles.srgb)
        : cmyk
          ? image.transformColorSpace(profiles.cmyk, profiles.srgb)
          : true;
      if (!converted) throw new Error('Could not convert the image colour profile to sRGB');
      // Never autoOrient: current MoarTube uploads ignore EXIF orientation.
      image.depth = 8;
      image.strip();
      const width = image.width,
        height = image.height;
      return image.write(MagickFormat.Rgba, (pixels) => ({
        width,
        height,
        data: Uint8Array.from(pixels),
      }));
    });
    parentPort.postMessage({ id, ...result }, [result.data.buffer]);
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
