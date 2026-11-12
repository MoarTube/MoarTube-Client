const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const magick = require('../../src/utils/image-runtime/magick.cjs');

test('generated desktop icons retain the brand gradient, white arrows and transparent corners', async (t) => {
  const source = path.resolve(__dirname, '../..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-icon-'));
  const modules = path.join(fixture, 'node_modules');
  t.after(() => {
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    assert(path.basename(fixture).startsWith('moartube-icon-'));
    if (fs.existsSync(modules)) fs.unlinkSync(modules);
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  for (const file of [
    'scripts/desktop-icon.mjs',
    'desktop/icon.svg',
    'src/utils/image-runtime/magick.cjs',
  ]) {
    const target = path.join(fixture, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target);
  }
  fs.symlinkSync(path.join(source, 'node_modules'), modules, 'junction');
  execFileSync(process.execPath, [path.join(fixture, 'scripts/desktop-icon.mjs')], {
    cwd: fixture,
    windowsHide: true,
    timeout: 10000,
  });
  await magick.initialize();
  function checkFrame(data, size) {
    magick.ImageMagick.read(data, (image) => {
      assert.equal(image.width, size);
      assert.equal(image.height, size);
      image.getPixels((pixels) => {
        const pixel = (x, y) =>
          Array.from(pixels.toByteArray(Math.floor(x * size), Math.floor(y * size), 1, 1, 'RGBA'));
        const top = pixel(0.2, 0.2);
        const bottom = pixel(0.8, 0.8);
        assert(top[0] > 180 && top[2] > 100 && top[1] < 60, 'magenta background');
        assert(top[0] > bottom[0] + 20 && bottom[2] > top[2] + 10, 'diagonal gradient');
        assert(
          pixel(0.3, 0.5)
            .slice(0, 3)
            .every((channel) => channel > 220),
          'white arrow'
        );
        assert.equal(pixel(0, 0)[3], 0, 'transparent corner');
      });
    });
  }
  checkFrame(fs.readFileSync(path.join(fixture, 'build/desktop/assets/icon.png')), 512);
  const ico = fs.readFileSync(path.join(fixture, 'build/desktop/assets/icon.ico'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), sizes.length);
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    checkFrame(ico.subarray(offset, offset + length), size);
  }
});
