const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { initializeImageMagick, ImageMagick, MagickFormat } = require('@imagemagick/magick-wasm');
const { renderImages, stopImages } = require('../../src/utils/image-runtime/client.cjs');
const { inspectInput } = require('../../src/utils/image-runtime/input.cjs');
const root = path.resolve(__dirname, '../..');
const fixture = (name) => fs.readFileSync(path.join(root, 'tests/fixtures/images', name));
const target = `${process.platform}-${process.arch}`;
const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
let ffmpegPath = process.env.FFMPEG_BIN;
if (!ffmpegPath) {
  const selectionFile = path.join(root, 'build/ffmpeg/state', target, 'selected.json');
  const selected = fs.existsSync(selectionFile) ? JSON.parse(fs.readFileSync(selectionFile)) : {};
  ffmpegPath = [
    path.join(root, 'build/ffmpeg/install', target, 'bin', executable),
    ...(selected.directory ? [path.join(selected.directory, selected.buildId, executable)] : []),
    ...(selected.runtime
      ? [
          path.join(
            root,
            'build/ffmpeg/candidates',
            target,
            selected.runtime,
            selected.buildId,
            executable
          ),
        ]
      : []),
  ].find((file) => fs.existsSync(file));
}
assert.ok(ffmpegPath, 'Stage FFmpeg or set FFMPEG_BIN before running image tests');
const options = { ffmpegPath };
const ready = initializeImageMagick(
  fs.readFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm'))
);
after(stopImages);
function rgba(data) {
  return ImageMagick.read(data, (image) =>
    image.write(MagickFormat.Rgba, (pixels) => Buffer.from(pixels))
  );
}
function error(a, b) {
  assert.equal(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
function withIcc(jpeg, profile) {
  const parts = [jpeg.subarray(0, 2)];
  const count = Math.ceil(profile.length / 65519);
  for (let i = 0; i < count; i++) {
    const bytes = profile.subarray(i * 65519, (i + 1) * 65519);
    const header = Buffer.alloc(18);
    header.writeUInt16BE(0xffe2);
    header.writeUInt16BE(bytes.length + 16, 2);
    header.write('ICC_PROFILE\0', 4, 'ascii');
    header[16] = i + 1;
    header[17] = count;
    parts.push(header, bytes);
  }
  parts.push(jpeg.subarray(2));
  return Buffer.concat(parts);
}

test('all six output presets decode with the expected dimensions and format', async () => {
  await ready;
  const outputs = [
    { width: 48, height: 48, format: 'png' },
    { width: 128, height: 128, format: 'png' },
    { width: 2560, height: 424, format: 'png' },
    { width: 100, height: 100, format: 'jpeg' },
    { width: 512, height: 288, format: 'jpeg' },
    { width: 1280, height: 720, format: 'jpeg' },
  ];
  const images = await renderImages(fixture('alpha.png'), outputs, options);
  for (const [i, o] of outputs.entries()) {
    const header = inspectInput(images[i]);
    assert.equal(header.width, o.width);
    assert.equal(header.height, o.height);
    assert.equal(header.format, o.format);
    assert.equal(rgba(images[i]).length, o.width * o.height * 4);
  }
});
test('P3 and CMYK with/without an ICC profile match pinned Sharp reference pixels', async () => {
  await ready;
  const cmyk = fixture('cmyk.jpg');
  const tagged = withIcc(
    cmyk,
    fs.readFileSync(path.join(root, 'src/utils/image-runtime/profiles/cmyk.icc'))
  );
  for (const [input, reference] of [
    [fixture('p3.png'), 'p3.png-srgb.png'],
    [cmyk, 'cmyk.jpg-srgb.png'],
    [tagged, 'cmyk.jpg-srgb.png'],
  ]) {
    assert.equal(inspectInput(input).normalize, true);
    const [output] = await renderImages(input, [{ width: 64, height: 48, format: 'png' }], options);
    assert.ok(error(rgba(output), rgba(fixture(reference))) < 1, reference);
  }
});
test('transparent PNG preserves alpha, and JPEG flattens transparent pixels against black', async () => {
  await ready;
  const [png, jpeg] = await renderImages(
    fixture('alpha.png'),
    [
      { width: 64, height: 48, format: 'png' },
      { width: 64, height: 48, format: 'jpeg' },
    ],
    options
  );
  const a = rgba(png),
    j = rgba(jpeg);
  assert.equal(a[3], 0);
  assert.ok(Math.abs(a[(24 * 64 + 24) * 4 + 3] - 128) <= 1);
  assert.equal(a[(24 * 64 + 48) * 4 + 3], 255);
  assert.ok(j[0] < 4 && j[1] < 4 && j[2] < 4);
  assert.equal(j[3], 255);
});
test('all EXIF orientation values preserve the existing unrotated policy', async () => {
  const source = fixture('rgb.jpg');
  let expected;
  for (let orientation = 1; orientation <= 8; orientation++) {
    const exif = Buffer.from(
      '45786966000049492a0008000000010012010300010000000100000000000000',
      'hex'
    );
    exif.writeUInt16LE(orientation, 24);
    const segment = Buffer.alloc(4);
    segment.writeUInt16BE(0xffe1);
    segment.writeUInt16BE(exif.length + 2, 2);
    const input = Buffer.concat([source.subarray(0, 2), segment, exif, source.subarray(2)]);
    const [output] = await renderImages(input, [{ width: 64, height: 48, format: 'png' }], options);
    expected ??= output;
    assert.deepEqual(output, expected);
  }
});
test('pixel and upload limits reject before decoder work, and malformed data does not poison the worker', async () => {
  const oversized = Buffer.from(fixture('alpha.png'));
  oversized.writeUInt32BE(40_000_001, 16);
  assert.throws(() => inspectInput(oversized), /megapixel/);
  assert.throws(() => inspectInput(Buffer.alloc(20 * 1024 ** 2 + 1)), /20 MiB/);
  await assert.rejects(
    renderImages(Buffer.from('invalid image'), [{ width: 48, height: 48, format: 'png' }], options)
  );
  const [valid] = await renderImages(
    fixture('p3.png'),
    [{ width: 48, height: 48, format: 'png' }],
    options
  );
  assert.equal(inspectInput(valid).width, 48);
});
test('bounded admission rejects excess work, cancellation and failed FFmpeg release the queue', async () => {
  const preset = [{ width: 48, height: 48, format: 'png' }];
  const jobs = Array.from({ length: 4 }, () => renderImages(fixture('rgb.jpg'), preset, options));
  await assert.rejects(renderImages(fixture('rgb.jpg'), preset, options), /busy/);
  await Promise.all(jobs);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    renderImages(fixture('p3.png'), preset, { ...options, signal: aborted.signal }),
    /cancel/
  );
  await assert.rejects(
    renderImages(fixture('rgb.jpg'), preset, { ffmpegPath: path.join(root, 'nonexistent-ffmpeg') })
  );
  const [valid] = await renderImages(fixture('rgb.jpg'), preset, options);
  assert.equal(inspectInput(valid).width, 48);
});

test('worker retains first-image support for SVG, WebP, GIF, BMP, TIFF and AVIF', async () => {
  await ready;
  const sources = [
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="red"/></svg>'
    ),
  ];
  sources.push(gzipSync(sources[0]));
  for (const format of [
    MagickFormat.WebP,
    MagickFormat.Gif,
    MagickFormat.Bmp,
    MagickFormat.Tiff,
    MagickFormat.Avif,
  ]) {
    sources.push(
      ImageMagick.read(fixture('alpha.png'), (image) =>
        image.write(format, (data) => Buffer.from(data))
      )
    );
  }
  for (const source of sources) {
    const [output] = await renderImages(
      source,
      [{ width: 48, height: 48, format: 'png' }],
      options
    );
    assert.equal(inspectInput(output).width, 48);
    assert.equal(rgba(output).length, 48 * 48 * 4);
  }
  const huge = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="6000"><rect width="8000" height="6000" fill="red"/></svg>'
  );
  await assert.rejects(
    renderImages(huge, [{ width: 48, height: 48, format: 'png' }], options),
    /megapixel/
  );
});

test('malformed or mismatched ICC profiles reject and a subsequent conversion still works', async () => {
  for (const input of [
    withIcc(fixture('rgb.jpg'), Buffer.from('not an ICC profile')),
    withIcc(
      fixture('cmyk.jpg'),
      fs.readFileSync(path.join(root, 'src/utils/image-runtime/profiles/srgb.icc'))
    ),
  ]) {
    await assert.rejects(renderImages(input, [{ width: 48, height: 48, format: 'png' }], options));
  }
  const [valid] = await renderImages(
    fixture('p3.png'),
    [{ width: 48, height: 48, format: 'png' }],
    options
  );
  assert.equal(inspectInput(valid).width, 48);
});
test('pinned standalone colour profiles have stable hashes', () => {
  for (const [name, hash] of [
    ['srgb', 'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353'],
    ['cmyk', '156e7c14f244cfc4ed83a755ca4803d80e15dd249b40fae82cb127d3902e15c7'],
  ])
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, `src/utils/image-runtime/profiles/${name}.icc`)))
        .digest('hex'),
      hash
    );
});
