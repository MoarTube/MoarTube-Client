import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { darwinTarget, inspectDarwinDependencies, run } from './darwin-native.mjs';
import { listedNames } from './verify-features.mjs';

export const darwinRequirements = {
  encoders: ['libx264', 'libvpx-vp9', 'libopus', 'aac', 'png', 'mjpeg', 'h264_videotoolbox'],
  decoders: ['h264', 'hevc', 'libdav1d', 'vp9', 'aac', 'opus', 'png', 'mjpeg', 'rawvideo'],
  filters: [
    'scale',
    'scale_vt',
    'hwupload',
    'hwdownload',
    'split',
    'fps',
    'overlay',
    'pad',
    'crop',
    'format',
    'aresample',
    'setsar',
    'premultiply',
    'unpremultiply',
    'sidedata',
  ],
  protocols: ['file', 'pipe', 'http', 'https', 'tls', 'tcp', 'udp', 'rtmp', 'rtmps'],
  muxers: ['hls', 'mp4', 'mpegts', 'flv', 'webm', 'image2', 'image2pipe'],
  demuxers: ['mov', 'matroska', 'mpegts', 'flv', 'hls', 'rawvideo'],
  hwaccels: ['videotoolbox'],
};

// FFmpeg protocols have separate input/output sections; format rows can list
// aliases. Use the same feature names for initial builds and later verification.
export function missingDarwinFeatures(capabilities) {
  return Object.entries(darwinRequirements).flatMap(([kind, required]) => {
    const available =
      kind === 'protocols'
        ? new Set([
            ...listedNames(capabilities[kind] ?? '', 'inputProtocols'),
            ...listedNames(capabilities[kind] ?? '', 'outputProtocols'),
          ])
        : listedNames(capabilities[kind] ?? '', kind);
    return required.filter((name) => !available.has(name)).map((name) => kind + ': ' + name);
  });
}

export function verifyDarwinBinaries({ ffmpeg, ffprobe, arch, reports }) {
  darwinTarget(arch);
  mkdirSync(reports, { recursive: true });
  const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const json = (name, value) =>
    writeFileSync(path.join(reports, name), JSON.stringify(value, null, 2) + '\n');
  const files = {};
  const dependencies = [];
  for (const [name, file] of Object.entries({ ffmpeg, ffprobe })) {
    const libraries = inspectDarwinDependencies(file, arch);
    if (!(statSync(file).mode & 0o111)) throw new Error('Executable permissions missing: ' + file);
    run('codesign', ['--verify', '--strict', file]);
    files[name] = { sha256: digest(file) };
    dependencies.push({ name, sha256: files[name].sha256, libraries });
  }
  const capabilities = Object.fromEntries(
    Object.keys(darwinRequirements).map((name) => [
      name,
      run(ffmpeg, ['-hide_banner', '-' + name], {
        stdio: 'pipe',
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      }),
    ])
  );
  const missing = missingDarwinFeatures(capabilities);
  json('features.json', {
    passed: missing.length === 0,
    required: darwinRequirements,
    capabilities,
    missing,
    binarySha256: Object.fromEntries(
      Object.entries(files).map(([name, file]) => [name, file.sha256])
    ),
  });
  json('dependencies.json', dependencies);
  if (missing.length) throw new Error('Missing Darwin FFmpeg features: ' + missing.join(', '));
  run(process.execPath, [
    fileURLToPath(new URL('./verify-software.mjs', import.meta.url)),
    ffmpeg,
    ffprobe,
    path.join(reports, 'software'),
  ]);
  const software = JSON.parse(readFileSync(path.join(reports, 'software/result.json'), 'utf8'));
  if (
    !software.results?.length ||
    software.results.some((result) => !result.passed) ||
    Object.entries({ ffmpeg, ffprobe }).some(
      ([name, file]) =>
        software.binarySha256?.[name] !== files[name].sha256 || digest(file) !== files[name].sha256
    )
  )
    throw new Error('Darwin software qualification failed or mismatches the binaries');
  return { files, software };
}
