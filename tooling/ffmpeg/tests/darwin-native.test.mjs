import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMachO,
  validateDarwinDependencies,
  parseDarwinTarget,
} from '../scripts/darwin-native.mjs';

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
  assert.doesNotThrow(() => validateMachO(binary()));
  assert.doesNotThrow(() => validateMachO(binary(0x01000007, 0x000c0000)));
  assert.throws(() => validateMachO(binary(0x0100000c)), /x86_64/);
  assert.throws(() => validateMachO(binary(0x01000007, 0x001a0000)), /newer/);
  const ios = binary();
  ios.writeUInt32LE(2, 40);
  assert.throws(() => validateMachO(ios), /macOS platform/);
  assert.throws(() => validateMachO(binary().subarray(0, 40)), /Truncated/);
  const corrupt = binary();
  corrupt.writeUInt32LE(0, 36);
  assert.throws(() => validateMachO(corrupt), /command size/);
});

test('Apple Silicon qualification rejects Intel binaries, fat binaries and newer OS requirements', () => {
  assert.doesNotThrow(() => validateMachO(binary(0x0100000c), 'arm64'));
  assert.throws(() => validateMachO(binary(), 'arm64'), /arm64/);
  assert.throws(() => validateMachO(binary(0x0100000c, 0x001a0000), 'arm64'), /newer/);
  const fat = binary(0x0100000c);
  fat.writeUInt32LE(0xcafebabe, 0);
  assert.throws(() => validateMachO(fat, 'arm64'), /thin arm64/);
  const ios = binary(0x0100000c);
  ios.writeUInt32LE(2, 40);
  assert.throws(() => validateMachO(ios, 'arm64'), /macOS platform/);
});

test('Darwin target parsing preserves the Intel default and accepts only explicit supported architectures', () => {
  assert.deepEqual(parseDarwinTarget(), { arch: 'x64', target: 'darwin-x64' });
  assert.deepEqual(parseDarwinTarget(['--arch=arm64']), { arch: 'arm64', target: 'darwin-arm64' });
  for (const args of [['--arch=ia32'], ['--arm64'], ['--arch=arm64', '--arch=x64']])
    assert.throws(() => parseDarwinTarget(args), /accept only/);
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
