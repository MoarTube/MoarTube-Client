import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolveFfmpegArtifact } from '../src/utils/ffmpeg-artifact.js';
import { resolveFfmpegBinaries } from '../src/utils/ffmpeg-path.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('moartube-artifact-')
    ) {
      throw new Error('Unexpected test path');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(target = 'win32-x64') {
  const extension = target.startsWith('win32-') ? '.exe' : '';
  const root = fs.mkdtempSync(path.join(tmpdir(), 'moartube-artifact-'));
  directories.push(root);
  const directory = path.join(root, 'ffmpeg', target);
  fs.mkdirSync(path.join(directory, 'test-r1'), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    target,
    buildId: 'test-r1',
    version: '9.0.2',
    files: {} as Record<string, { path: string; sha256: string }>,
  };
  for (const name of ['ffmpeg', 'ffprobe']) {
    const bytes = Buffer.from(name);
    fs.writeFileSync(path.join(directory, `test-r1/${name}${extension}`), bytes);
    manifest.files[name] = {
      path: `test-r1/${name}${extension}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const save = () => {
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  };
  save();
  return { root, directory, manifest, save };
}

it('resolves and verifies both executables from an immutable build directory', () => {
  const { root } = fixture();
  expect(resolveFfmpegArtifact(root, 'win32-x64')).toEqual({
    buildId: 'test-r1',
    version: '9.0.2',
    ffmpeg: path.join(root, 'ffmpeg/win32-x64/test-r1/ffmpeg.exe'),
    ffprobe: path.join(root, 'ffmpeg/win32-x64/test-r1/ffprobe.exe'),
  });
  expect(resolveFfmpegArtifact(root, 'linux-x64')).toBeUndefined();
});

it('rejects a corrupt matching probe instead of using another installation', () => {
  const { root, directory } = fixture();
  fs.writeFileSync(path.join(directory, 'test-r1/ffprobe.exe'), 'corrupt');
  expect(() => resolveFfmpegArtifact(root, 'win32-x64')).toThrow('checksum mismatch');
});

it('selects an ARM64 packaged pair without substituting an x64 artifact', () => {
  const { root, directory } = fixture('linux-arm64');
  expect(
    resolveFfmpegBinaries({
      root: '/unused',
      platform: 'linux',
      arch: 'arm64',
      environmentPath: '',
      resourceRoot: root,
    })
  ).toMatchObject({
    ffmpeg: path.join(directory, 'test-r1/ffmpeg'),
    ffprobe: path.join(directory, 'test-r1/ffprobe'),
  });
  expect(resolveFfmpegArtifact(root, 'linux-x64')).toBeUndefined();
  const corrupt = fixture('linux-arm64');
  fs.writeFileSync(path.join(corrupt.directory, 'test-r1/ffprobe'), 'corrupt');
  expect(() => resolveFfmpegArtifact(corrupt.root, 'linux-arm64')).toThrow('checksum mismatch');
});

it('resolves installed resources without requiring a developer compilation', () => {
  const { root } = fixture();
  const selected = resolveFfmpegBinaries({
    resourceRoot: root,
    platform: 'win32',
    arch: 'x64',
    environmentPath: '',
  });
  expect(selected.buildId).toBe('test-r1');
  expect(selected.ffprobe).toBe(path.join(root, 'ffmpeg/win32-x64/test-r1/ffprobe.exe'));
});

it('uses verified staged resources when no local compilation exists', () => {
  const { root } = fixture();
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'resources'), { recursive: true });
  fs.cpSync(path.join(root, 'ffmpeg'), path.join(project, 'resources/ffmpeg'), { recursive: true });
  expect(
    resolveFfmpegBinaries({ root: project, platform: 'win32', arch: 'x64', environmentPath: '' })
      .buildId
  ).toBe('test-r1');
});

it('rejects cross-target and escaping manifest entries', () => {
  const { root, manifest, save } = fixture();
  manifest.target = 'linux-x64';
  save();
  expect(() => resolveFfmpegArtifact(root, 'win32-x64')).toThrow('Invalid');
  manifest.target = 'win32-x64';
  manifest.buildId = '..';
  save();
  expect(() => resolveFfmpegArtifact(root, 'win32-x64')).toThrow('Invalid');
  manifest.buildId = 'test-r1';
  const entry = manifest.files['ffmpeg'];
  if (entry === undefined) {
    throw new Error('Missing test entry');
  }
  entry.path = '../ffmpeg.exe';
  save();
  expect(() => resolveFfmpegArtifact(root, 'win32-x64')).toThrow('Invalid');
});
