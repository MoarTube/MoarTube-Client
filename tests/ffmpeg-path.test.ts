import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Config } from '../src/config/index.js';
import type { Logger } from '../src/utils/logger.js';
import type { Container } from '../src/core/container.js';
import { FfmpegService } from '../src/services/ffmpeg.js';
import { LifecycleManager } from '../src/core/lifecycle.js';
import { resolveFfmpegBinaries } from '../src/utils/ffmpeg-path.js';

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('moartube-ffmpeg-path-')
    ) {
      throw new Error('Unexpected test directory');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'moartube-ffmpeg-path-'));
  directories.push(root);
  return root;
}

function compileFixture(root: string, target = 'win32-x64'): { ffmpeg: string; ffprobe: string } {
  const directory = path.join(root, 'build/ffmpeg/install', target, 'bin');
  fs.mkdirSync(directory, { recursive: true });
  const extension = target.startsWith('win32-') ? '.exe' : '';
  const binaries = {
    ffmpeg: path.join(directory, `ffmpeg${extension}`),
    ffprobe: path.join(directory, `ffprobe${extension}`),
  };
  fs.writeFileSync(binaries.ffmpeg, 'test');
  fs.writeFileSync(binaries.ffprobe, 'test');
  return binaries;
}

function service(root: string, ffmpegPath?: string): FfmpegService {
  return new FfmpegService(
    {} as Logger,
    { clientSettings: { ffmpegPath }, paths: { root } } as Config
  );
}

it('uses settings before the environment override', () => {
  vi.stubEnv('FFMPEG_BIN', 'environment.exe');
  expect(service(fixture(), 'settings.exe').getPath()).toBe('settings.exe');
});

it('re-evaluates overrides and returns to the compiled binary when cleared', () => {
  const root = fixture();
  const compiled = compileFixture(root, `${process.platform}-${process.arch}`);
  vi.stubEnv('FFMPEG_BIN', 'first.exe');
  const ffmpeg = service(root);
  expect(ffmpeg.getPath()).toBe('first.exe');
  vi.stubEnv('FFMPEG_BIN', 'second.exe');
  expect(ffmpeg.getPath()).toBe('second.exe');
  vi.stubEnv('FFMPEG_BIN', '');
  expect(ffmpeg.getPath()).toBe(compiled.ffmpeg);
  expect(ffmpeg.getProbePath()).toBe(compiled.ffprobe);
});

it('selects the Windows compilation ahead of stale staged resources without using cwd', () => {
  const root = fixture();
  const compiled = compileFixture(root);
  fs.mkdirSync(path.join(root, 'resources/ffmpeg/win32-x64'), { recursive: true });
  fs.writeFileSync(path.join(root, 'resources/ffmpeg/win32-x64/manifest.json'), 'stale manifest');
  vi.spyOn(process, 'cwd').mockReturnValue(path.dirname(root));
  expect(
    resolveFfmpegBinaries({ root, platform: 'win32', arch: 'x64', environmentPath: '' })
  ).toEqual(compiled);
});

it('selects native Unix filenames and never takes another target architecture', () => {
  const root = fixture();
  const compiled = compileFixture(root, 'linux-arm64');
  expect(
    resolveFfmpegBinaries({ root, platform: 'linux', arch: 'arm64', environmentPath: '' })
  ).toEqual(compiled);
  expect(() =>
    resolveFfmpegBinaries({ root, platform: 'linux', arch: 'x64', environmentPath: '' })
  ).toThrow('npm run ffmpeg:build:linux');
});

it('requires both executables and gives the developer the build command', () => {
  const root = fixture();
  const options = { root, platform: 'win32' as const, arch: 'x64', environmentPath: '' };
  expect(() => resolveFfmpegBinaries(options)).toThrow('npm.cmd run ffmpeg:build:windows');
  const compiled = compileFixture(root);
  fs.unlinkSync(compiled.ffprobe);
  expect(() => resolveFfmpegBinaries(options)).toThrow('compiled FFmpeg and FFprobe');
});

it('does not use a developer build when an installed Electron resource root is specified', () => {
  const root = fixture();
  compileFixture(root);
  expect(() =>
    resolveFfmpegBinaries({
      root,
      resourceRoot: path.join(root, 'installed'),
      platform: 'win32',
      arch: 'x64',
      environmentPath: '',
    })
  ).toThrow('compiled FFmpeg');
});

it('Electron development ignores the framework resource directory and uses the local build', () => {
  const root = fixture();
  const compiled = compileFixture(root, `${process.platform}-${process.arch}`);
  vi.stubEnv('FFMPEG_BIN', '');
  vi.stubEnv('MOARTUBE_DESKTOP_MODE', 'development');
  vi.stubEnv('MOARTUBE_RESOURCE_ROOT', path.join(root, 'framework-resources'));
  expect(service(root).getPath()).toBe(compiled.ffmpeg);
});

it('reports an invalid explicit override instead of falling back', async () => {
  vi.stubEnv('FFMPEG_BIN', '');
  await expect(
    service(fixture(), 'moartube-nonexistent-explicit-override.exe').getDiagnostics()
  ).rejects.toThrow('moartube-nonexistent-explicit-override.exe');
});

it('fails startup before GPU fallback, settings changes or directory cleanup when no build exists', async () => {
  vi.stubEnv('FFMPEG_BIN', '');
  const ffmpegService = service(fixture());
  const assess = vi.spyOn(ffmpegService, 'assessGpus');
  const save = vi.fn();
  const services = {
    logger: { info: vi.fn(), debug: vi.fn() },
    ffmpegService,
    config: { saveClientSettings: save },
  };
  const lifecycle = new LifecycleManager({
    resolve: (name: keyof typeof services) => services[name],
  } as unknown as Container);
  await expect(lifecycle.onStartup()).rejects.toThrow('compiled FFmpeg');
  expect(assess).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
