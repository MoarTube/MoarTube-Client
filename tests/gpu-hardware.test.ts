import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FfmpegService } from '../src/services/ffmpeg.js';
import { Logger } from '../src/utils/logger.js';
import type { Config } from '../src/config/index.js';
import { DEFAULT_CLIENT_SETTINGS } from '../src/config/defaults.js';
import { getGpuProcessEnvironment } from '../src/utils/hardware.js';
import { GPU_PROBE_H264 } from '../src/utils/gpu-probe.js';
import { VideoPublishService } from '../src/services/video-publish.js';
import { LiveStreamService } from '../src/services/live-stream.js';

// Opt in on a GPU host: MOARTUBE_TEST_GPU=1 npx vitest run tests/gpu-hardware.test.ts
// Require a backend with MOARTUBE_TEST_GPU_BACKEND=qsv, vaapi, or videotoolbox.
// MOARTUBE_TEST_GPU_VENDOR=Intel distinguishes Intel VA-API from AMD VA-API.
it.skipIf(process.env['MOARTUBE_TEST_GPU'] !== '1')(
  'probes compressed input and publishes playable MP4/HLS on actual available GPUs',
  async () => {
    const service = new FfmpegService(new Logger(), { clientSettings: {} } as Config);
    const capabilities = await service.assessGpus(true);
    const backend = process.env['MOARTUBE_TEST_GPU_BACKEND'];
    const vendor = process.env['MOARTUBE_TEST_GPU_VENDOR'];
    const candidates = capabilities.filter(
      (gpu) =>
        (backend === undefined || gpu.backend === backend) &&
        (vendor === undefined || gpu.processingAgentName === vendor)
    );
    if (backend !== undefined || vendor !== undefined) {
      expect(candidates.length, JSON.stringify(capabilities)).toBeGreaterThan(0);
      for (const gpu of candidates) {
        expect(gpu.available, JSON.stringify(gpu)).toBe(true);
      }
    }
    const available = candidates.filter((gpu) => gpu.available);
    expect(available.length, JSON.stringify(capabilities)).toBeGreaterThan(0);
    const root = await fs.mkdtemp(path.join(tmpdir(), 'moartube-gpu-test-'));
    try {
      const source = path.join(root, 'source.h264');
      await fs.writeFile(source, GPU_PROBE_H264);
      for (const gpu of available) {
        const agent = { ...gpu, processingAgentType: 'gpu' };
        const context = {
          settingsRepository: {
            getClientSettings: () => ({ ...DEFAULT_CLIENT_SETTINGS, processingAgent: agent }),
            getVideosDirectoryPath: () => root,
          },
        } as unknown as VideoPublishService;
        for (const job of gpu.backend === 'nvenc' ? ['mp4', 'm3u8', 'live'] : ['mp4', 'm3u8']) {
          const format = job === 'live' ? 'm3u8' : job;
          const videoId = `${gpu.backend ?? 'gpu'}-${job}`;
          const segments = path.join(root, videoId, 'adaptive', 'm3u8', '360p');
          await fs.mkdir(segments, { recursive: true });
          const output = path.join(segments, `output.${format}`);
          let args = VideoPublishService.prototype['generateFfmpegVideoArguments'].call(
            context,
            videoId,
            '360p',
            format,
            source,
            output,
            '.h264',
            'https://node.example'
          );
          if (job === 'live') {
            args = LiveStreamService.prototype['generateFfmpegLiveArguments'].call(
              context as unknown as LiveStreamService,
              videoId,
              '360p',
              'm3u8',
              source,
              false,
              'https://node.example'
            );
            // Exercise the live video filter/encoder/HLS pipeline with a local
            // compressed fixture; listener/network transport is tested separately.
            for (const option of ['-listen', '-timeout']) {
              args.splice(args.indexOf(option), 2);
            }
            args[args.indexOf('-f') + 1] = 'h264';
            args.splice(
              args.length - 1,
              1,
              '-hls_segment_filename',
              path.join(segments, 'live-%d.ts'),
              output
            );
          }
          const result = spawnSync(
            service.getPath(),
            ['-hide_banner', '-loglevel', 'error', ...args],
            {
              timeout: 15000,
              windowsHide: true,
              env: getGpuProcessEnvironment(agent),
            }
          );
          expect(result.status, `${gpu.id} ${format}: ${result.stderr?.toString() ?? ''}`).toBe(0);
          expect((await fs.stat(output)).size).toBeGreaterThan(0);
          let playable = output;
          if (format === 'm3u8') {
            const manifest = await fs.readFile(output, 'utf8');
            const segment = manifest
              .split(/\r?\n/)
              .find((line) => line.trim() !== '' && !line.startsWith('#'));
            expect(segment).toBeDefined();
            playable = path.join(segments, path.basename(new URL(segment ?? '').pathname));
          }
          const decoded = spawnSync(
            service.getPath(),
            [
              '-hide_banner',
              '-loglevel',
              'error',
              ...(format === 'm3u8' ? ['-f', 'mpegts'] : []),
              '-i',
              playable,
              '-map',
              '0:v:0',
              '-frames:v',
              '1',
              '-f',
              'null',
              '-',
            ],
            { timeout: 15000, windowsHide: true }
          );
          expect(decoded.status, `${gpu.id} ${format}: ${decoded.stderr?.toString() ?? ''}`).toBe(
            0
          );
        }
        if (gpu.backend === 'nvenc') {
          for (const [size, resolution, expected] of [
            ['1280x720', '360p', '640x360'],
            ['720x1280', '360p', '202x360'],
            ['852x478', '480p', '854x478'],
            ['478x852', '480p', '268x480'],
          ] as const) {
            const fixture = path.join(root, `source-${size}.h264`);
            const generated = spawnSync(
              service.getPath(),
              [
                '-hide_banner',
                '-loglevel',
                'error',
                '-f',
                'lavfi',
                '-i',
                `testsrc2=size=${size}:rate=30`,
                '-frames:v',
                '3',
                '-c:v',
                'libx264',
                '-pix_fmt',
                'yuv420p',
                fixture,
              ],
              { encoding: 'utf8', timeout: 15000, windowsHide: true }
            );
            expect(generated.status, generated.stderr).toBe(0);
            const output = path.join(root, `scaled-${size}.mp4`);
            const args = VideoPublishService.prototype['generateFfmpegVideoArguments'].call(
              context,
              'geometry',
              resolution,
              'mp4',
              fixture,
              output,
              '.h264',
              'https://node.example'
            );
            const encoded = spawnSync(
              service.getPath(),
              ['-hide_banner', '-loglevel', 'error', ...args],
              {
                encoding: 'utf8',
                timeout: 15000,
                windowsHide: true,
                env: getGpuProcessEnvironment(agent),
              }
            );
            expect(encoded.status, encoded.stderr).toBe(0);
            // Decode the completed output separately to verify actual dimensions.
            const decoded = spawnSync(
              service.getPath(),
              [
                '-hide_banner',
                '-i',
                output,
                '-vf',
                'showinfo',
                '-frames:v',
                '1',
                '-f',
                'null',
                '-',
              ],
              { encoding: 'utf8', timeout: 15000, windowsHide: true }
            );
            expect(decoded.status, decoded.stderr).toBe(0);
            expect(decoded.stderr).toContain(`s:${expected}`);
          }
        }
      }
    } finally {
      if (
        path.dirname(root) !== path.resolve(tmpdir()) ||
        !path.basename(root).startsWith('moartube-gpu-test-')
      ) {
        throw new Error('Unexpected GPU test directory');
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  120000
);
