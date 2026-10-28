import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  chmodSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const [ffmpegArg, ffprobeArg, directoryArg] = process.argv.slice(2);
if (!ffmpegArg || !ffprobeArg)
  throw new Error('Usage: verify-software.mjs <ffmpeg.exe> <ffprobe.exe> [directory]');
const target = `${process.platform}-${process.arch}`;
const directory = path.resolve(directoryArg ?? `build/ffmpeg/reports/${target}/software`);
// Exercise executable and media paths containing spaces and non-ASCII text.
const fixture = path.join(directory, 'media espace café 日本語');
mkdirSync(fixture, { recursive: true });
const extension = process.platform === 'win32' ? '.exe' : '';
const ffmpeg = path.join(fixture, `ffmpeg${extension}`);
const ffprobe = path.join(fixture, `ffprobe${extension}`);
copyFileSync(path.resolve(ffmpegArg), ffmpeg);
copyFileSync(path.resolve(ffprobeArg), ffprobe);
if (process.platform !== 'win32') {
  chmodSync(ffmpeg, 0o755);
  chmodSync(ffprobe, 0o755);
}
const commands = [];
function run(executable, args, input) {
  commands.push({ executable, args });
  try {
    return execFileSync(executable, args, {
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
      input,
    });
  } catch (error) {
    throw new Error(`${path.basename(executable)} failed: ${error.stderr ?? error.message}`);
  }
}
const ff = (args, input) =>
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], input);
const results = [];
try {
  const corpus = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
  const metadata = JSON.parse(readFileSync(path.join(corpus, 'manifest.json'), 'utf8'));
  for (const sample of metadata.fixtures) {
    const input = path.join(corpus, sample.file);
    if (createHash('sha256').update(readFileSync(input)).digest('hex') !== sample.sha256)
      throw new Error(`Fixture checksum mismatch: ${sample.file}`);
    ff(['-i', input, '-f', 'null', '-']);
    results.push({
      workflow: 'software input decoding',
      fixture: sample.file,
      codec: sample.codec,
      bitDepth: sample.bitDepth,
      passed: true,
    });
  }
  const source = path.join(fixture, 'source.mp4');
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    source,
  ]);
  for (const [format, video, audio, extension] of [
    ['mp4', 'libx264', 'aac', 'mp4'],
    ['hls', 'libx264', 'aac', 'm3u8'],
    ['webm', 'libvpx-vp9', 'libopus', 'webm'],
    ['ogg', 'libvpx', 'libopus', 'ogg'],
  ]) {
    const output = path.join(fixture, `output.${extension}`);
    ff([
      '-i',
      source,
      '-vf',
      'scale=640:360',
      '-c:v',
      video,
      '-b:v',
      '500k',
      '-g',
      '30',
      '-c:a',
      audio,
      ...(format === 'hls'
        ? ['-hls_time', '1', '-hls_segment_filename', path.join(fixture, 'segment-%d.ts')]
        : []),
      ...(format === 'mp4' ? ['-movflags', 'faststart'] : []),
      '-f',
      format,
      output,
    ]);
    const probe = JSON.parse(
      run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])
    );
    const v = probe.streams.find((stream) => stream.codec_type === 'video');
    const a = probe.streams.find((stream) => stream.codec_type === 'audio');
    if (v?.width !== 640 || v?.height !== 360 || !a || Number(probe.format.duration) < 1)
      throw new Error(`${format}: invalid dimensions, audio or duration`);
    const expectedVideo = { libx264: 'h264', 'libvpx-vp9': 'vp9', libvpx: 'vp8' }[video];
    if (v.codec_name !== expectedVideo || a.codec_name !== (audio === 'libopus' ? 'opus' : 'aac'))
      throw new Error(`${format}: unexpected codecs`);
    ff(['-i', output, '-f', 'null', '-']);
    results.push({ format, passed: true, probe });
  }
  const jpeg = path.join(fixture, 'import.jpg');
  ff(['-ss', '0.5', '-i', source, '-frames:v', '1', jpeg]);
  const segment = readdirSync(fixture).find((name) => /^segment-.*\.ts$/.test(name));
  if (!segment) throw new Error('HLS segments missing');
  ff(
    ['-i', 'pipe:0', '-frames:v', '1', path.join(fixture, 'preview.jpg')],
    readFileSync(path.join(fixture, segment))
  );
  results.push({ workflow: 'import and piped live segment JPEG extraction', passed: true });
  console.log(`Software media checks passed: ${directory}`);
} catch (error) {
  results.push({ passed: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  writeFileSync(
    path.join(directory, 'result.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        binarySha256: {
          ffmpeg: createHash('sha256').update(readFileSync(ffmpeg)).digest('hex'),
          ffprobe: createHash('sha256').update(readFileSync(ffprobe)).digest('hex'),
        },
        results,
        commands,
      },
      null,
      2
    ) + '\n'
  );
}
