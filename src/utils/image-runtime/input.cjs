const MAX_BYTES = 20 * 1024 ** 2;
const MAX_PIXELS = 40_000_000;

function dimensions(width, height) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_PIXELS
  )
    throw new Error('Image exceeds the 40 megapixel limit or has invalid dimensions');
  return { width, height };
}

/** Header-only admission before either decoder allocates its pixel buffers. */
function inspectInput(input) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_BYTES)
    throw new Error('Image must contain between 1 byte and 20 MiB');
  if (input.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    if (input.length < 33 || input.toString('ascii', 12, 16) !== 'IHDR')
      throw new Error('Invalid PNG header');
    const size = dimensions(input.readUInt32BE(16), input.readUInt32BE(20));
    let normalize = input[24] !== 8;
    let hasProfile = false;
    let alpha = [4, 6].includes(input[25]);
    for (let offset = 8; offset + 12 <= input.length; ) {
      const length = input.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > input.length) throw new Error('Truncated PNG chunk');
      const type = input.toString('ascii', offset + 4, offset + 8);
      if (['iCCP', 'cHRM', 'gAMA', 'cICP'].includes(type)) normalize = true;
      if (type === 'iCCP') hasProfile = true;
      if (type === 'tRNS') alpha = true;
      if (type === 'IDAT' || type === 'IEND') break;
      offset = end;
    }
    return { ...size, format: 'png', normalize, alpha, hasProfile };
  }
  if (input[0] === 0xff && input[1] === 0xd8) {
    let size;
    let normalize = false;
    let hasProfile = false;
    for (let offset = 2; offset < input.length; ) {
      if (input[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
      while (input[offset] === 0xff) offset++;
      const marker = input[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > input.length) throw new Error('Truncated JPEG header');
      const length = input.readUInt16BE(offset);
      if (length < 2 || offset + length > input.length) throw new Error('Truncated JPEG segment');
      if (marker === 0xe2 && input.toString('ascii', offset + 2, offset + 14) === 'ICC_PROFILE\0')
        normalize = hasProfile = true;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker
        )
      ) {
        if (length < 8) throw new Error('Invalid JPEG dimensions');
        size = dimensions(input.readUInt16BE(offset + 5), input.readUInt16BE(offset + 3));
        normalize ||= input[offset + 2] !== 8 || ![1, 3].includes(input[offset + 7]);
      }
      offset += length;
    }
    if (!size) throw new Error('JPEG dimensions missing');
    return { ...size, format: 'jpeg', normalize, alpha: false, hasProfile };
  }
  // Other previously accepted image formats are pinged inside the bounded WASM
  // worker before decoding. Do not silently narrow the API to the UI's JPG/PNG.
  const svg = /^\s*(?:<\?xml\b|<!--|<svg(?:\s|>))/i.test(input.subarray(0, 4096).toString('utf8'));
  return { format: svg ? 'svg' : 'other', normalize: true, alpha: true };
}
module.exports = { inspectInput, dimensions, MAX_BYTES, MAX_PIXELS };
