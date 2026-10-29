import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMachOX64, validateDarwinDependencies } from '../scripts/darwin-native.mjs';

function binary(cpu = 0x01000007, minimum = 0x000f0000) {
  const data = Buffer.alloc(56);
  data.writeUInt32LE(0xfeedfacf, 0);
  data.writeUInt32LE(cpu, 4);
  data.writeUInt32LE(1, 16);
  data.writeUInt32LE(24, 20);
  data.writeUInt32LE(0x32, 32);
  data.writeUInt32LE(24, 36);
  data.writeUInt32LE(1, 40);
  data.writeUInt32LE(minimum, 44);
  return data;
}

test('Darwin qualification rejects wrong architecture, platform and newer deployment targets', () => {
  assert.doesNotThrow(() => validateMachOX64(binary()));
  assert.doesNotThrow(() => validateMachOX64(binary(0x01000007, 0x000c0000)));
  assert.throws(() => validateMachOX64(binary(0x0100000c)), /x86_64/);
  assert.throws(() => validateMachOX64(binary(0x01000007, 0x001a0000)), /newer/);
  const ios = binary();
  ios.writeUInt32LE(2, 40);
  assert.throws(() => validateMachOX64(ios), /macOS platform/);
  assert.throws(() => validateMachOX64(binary().subarray(0, 40)), /Truncated/);
  const corrupt = binary();
  corrupt.writeUInt32LE(0, 36);
  assert.throws(() => validateMachOX64(corrupt), /command size/);
});

test('Darwin FFmpeg cannot depend on a build machine Homebrew or relative library', () => {
  const system =
    'ffmpeg:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n\t/System/Library/Frameworks/VideoToolbox.framework/Versions/A/VideoToolbox (compatibility version 1.0.0)\n';
  assert.equal(validateDarwinDependencies(system).length, 2);
  for (const library of [
    '/opt/homebrew/lib/libopus.dylib',
    '/usr/local/opt/libvpx/lib/libvpx.dylib',
    '@rpath/libdav1d.dylib',
  ])
    assert.throws(
      () => validateDarwinDependencies(system + `\t${library} (compatibility version 1.0.0)\n`),
      /Non-system/
    );
});
