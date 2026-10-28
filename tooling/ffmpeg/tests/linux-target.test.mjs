import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linuxTarget, parseLinuxTarget } from '../scripts/linux-target.mjs';
import { ffmpegPaths } from '../../build-paths.cjs';

test('selects isolated ARM64 output and Docker platform, preserving the x64 default', () => {
  assert.equal(parseLinuxTarget([]).target, 'linux-x64');
  const arm = parseLinuxTarget(['--arch=arm64']);
  assert.equal(arm.target, 'linux-arm64');
  assert.equal(arm.dockerPlatform, 'linux/arm64');
  assert.equal(arm.cpu, 'armv8-a');
  assert.notEqual(
    ffmpegPaths('/project', arm.target).install,
    ffmpegPaths('/project', 'linux-x64').install
  );
});
test('rejects unsupported or malformed architecture requests before invoking Docker', () => {
  for (const args of [
    ['--arch=arm'],
    ['--arch=../x64'],
    ['--arch'],
    ['--arch=arm64', '--arch=x64'],
  ])
    assert.throws(() => parseLinuxTarget(args));
  assert.throws(() => linuxTarget('amd64'));
});
