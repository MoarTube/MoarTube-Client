import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFfmpegArtifact } from './ffmpeg-artifact.js';

export interface FfmpegBinaries {
  ffmpeg: string;
  ffprobe: string;
  buildId?: string;
}

interface ResolveOptions {
  root?: string | undefined;
  resourceRoot?: string | undefined;
  ffmpegPath?: string | undefined;
  environmentPath?: string | undefined;
  platform?: NodeJS.Platform;
  arch?: string;
}

/** Find our package from the module location, independent of the launch directory. */
function clientRoot(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const contents = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: string };
      if (contents.name === '@moartube/moartube-client') {
        return directory;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(
        'Cannot locate the MoarTube client package to resolve its compiled FFmpeg dependency.'
      );
    }
    directory = parent;
  }
}

export function resolveFfmpegBinaries(options: ResolveOptions = {}): FfmpegBinaries {
  const platform = options.platform ?? process.platform;
  const target = `${platform}-${options.arch ?? process.arch}`;
  const extension = platform === 'win32' ? '.exe' : '';
  const configured = options.ffmpegPath;
  const environment = options.environmentPath ?? process.env['FFMPEG_BIN'];
  const override = configured !== undefined && configured !== '' ? configured : environment;
  // Explicit overrides remain explicit: execution failures never select another binary.
  if (override !== undefined && override !== '') {
    return { ffmpeg: override, ffprobe: path.join(path.dirname(override), `ffprobe${extension}`) };
  }
  const buildCommand =
    target === 'win32-x64'
      ? 'Run "npm.cmd run ffmpeg:build:windows" from the MoarTube-Client repository.'
      : target === 'linux-arm64'
        ? 'Run "npm run ffmpeg:build:linux:arm64" from the MoarTube-Client repository (requires Docker with Linux containers).'
        : target === 'linux-x64'
          ? 'Run "npm run ffmpeg:build:linux" from the MoarTube-Client repository (requires Docker with Linux containers).'
          : target === 'darwin-x64'
            ? 'Run "npm run ffmpeg:build:darwin" on an Intel Mac or the macOS GitHub Actions runner first.'
            : target === 'darwin-arm64'
              ? 'Run "npm run ffmpeg:build:darwin:arm64" on an Apple Silicon Mac or native ARM64 macOS GitHub Actions runner first.'
              : `Compile FFmpeg for ${target} first; automated recipes support Windows x64, Linux x64/ARM64 and macOS x64/ARM64.`;
  const missing = (expected: string): Error =>
    new Error(
      `MoarTube requires compiled FFmpeg and FFprobe for ${target}. ${buildCommand} Expected binaries at: ${expected}.`
    );
  if (options.resourceRoot !== undefined) {
    const artifact = resolveFfmpegArtifact(options.resourceRoot, target);
    if (artifact === undefined) {
      throw missing(path.join(options.resourceRoot, 'ffmpeg', target));
    }
    return artifact;
  }
  const root = options.root ?? clientRoot();
  const directory = path.join(root, 'build', 'ffmpeg', 'install', target, 'bin');
  const ffmpeg = path.join(directory, `ffmpeg${extension}`);
  const ffprobe = path.join(directory, `ffprobe${extension}`);
  const present = (file: string): boolean => fs.existsSync(file) && fs.statSync(file).isFile();
  if (fs.existsSync(ffmpeg) || fs.existsSync(ffprobe)) {
    if (!present(ffmpeg) || !present(ffprobe)) {
      throw missing(directory);
    }
    return { ffmpeg, ffprobe };
  }
  const artifact = resolveFfmpegArtifact(path.join(root, 'resources'), target);
  if (artifact !== undefined) {
    return artifact;
  }
  throw missing(directory);
}
