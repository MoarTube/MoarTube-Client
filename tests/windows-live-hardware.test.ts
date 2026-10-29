import { expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { FfmpegService } from '../src/services/ffmpeg.js';
import { LiveStreamService } from '../src/services/live-stream.js';
import { DEFAULT_CLIENT_SETTINGS } from '../src/config/defaults.js';
import type { Config } from '../src/config/index.js';
import { Logger } from '../src/utils/logger.js';
import { getGpuProcessEnvironment } from '../src/utils/hardware.js';
import { assertWindowsHardwarePipeline } from './integration/gpu-policy.js';
import { withLiveHlsFiles } from '../src/utils/live-hls.js';

// This exercises real loopback RTMP plus the client's hardware live commands.
// It does not provision a MoarTube Node or certify the complete delivery stack.
it.skipIf(process.platform !== 'win32' || process.env['MOARTUBE_TEST_GPU'] !== '1')(
  'ingests real RTMP and scales/encodes live HLS on the explicitly required Windows backend',
  async () => {
    const backend = process.env['MOARTUBE_TEST_GPU_BACKEND'];
    expect(['amf', 'nvenc', 'qsv']).toContain(backend);
    const service = new FfmpegService(new Logger(), { clientSettings: {} } as Config);
    const capabilities = await service.assessGpus(true);
    const gpuId = process.env['MOARTUBE_TEST_GPU_ID'];
    const gpu = capabilities.find(
      (device) =>
        device.backend === backend &&
        device.available &&
        (gpuId === undefined || device.id === gpuId)
    );
    expect(gpu, JSON.stringify(capabilities)).toBeDefined();
    if (gpu === undefined) {
      throw new Error(`Required backend unavailable: ${backend ?? 'unspecified'}`);
    }
    const agent = { ...gpu, processingAgentType: 'gpu' };
    const root = await fs.mkdtemp(path.join(tmpdir(), 'moartube-rtmp-'));
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('moartube-rtmp-')
    ) {
      throw new Error('Unexpected RTMP fixture directory');
    }
    const children: ChildProcess[] = [];
    const pending: Promise<unknown>[] = [];
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected loopback TCP address');
    }
    const url = `rtmp://127.0.0.1:${String(address.port)}/live/test`;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    const launch = (
      executable: string,
      args: string[],
      environment = process.env
    ): Promise<{ status: number | null; stderr: string; stdout: string }> => {
      const child = spawn(executable, args, { windowsHide: true, env: environment });
      children.push(child);
      let stderr = '';
      let stdout = '';
      child.stderr.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-4 * 1024 * 1024);
      });
      child.stdout.on('data', (data: Buffer) => {
        stdout = (stdout + data.toString()).slice(-4 * 1024 * 1024);
      });
      const deadline = setTimeout(() => child.kill(), 30000);
      const result = new Promise<{ status: number | null; stderr: string; stdout: string }>(
        (resolve, reject) => {
          child.once('error', (error) => {
            clearTimeout(deadline);
            reject(error);
          });
          child.once('close', (status) => {
            clearTimeout(deadline);
            resolve({ status, stderr, stdout });
          });
        }
      );
      pending.push(result);
      return result;
    };
    try {
      const context = {
        settingsRepository: {
          getClientSettings: () => ({ ...DEFAULT_CLIENT_SETTINGS, processingAgent: agent }),
        },
      } as unknown as LiveStreamService;
      let args = LiveStreamService.prototype['generateFfmpegLiveArguments'].call(
        context,
        'live',
        '360p',
        'm3u8',
        url,
        false,
        'https://node.example'
      );
      // Keep decoder/device/scaler/encoder and RTMP options exactly as generated.
      // Direct HLS output locally so the matching probe can validate the result.
      args.splice(args.indexOf('-hls_base_url'), 2);
      const output = path.join(root, 'live.m3u8');
      args = withLiveHlsFiles(args, output, '360p');
      assertWindowsHardwarePipeline(args, backend ?? '');
      const receiver = launch(
        service.getPath(),
        ['-hide_banner', '-loglevel', 'verbose', ...args],
        getGpuProcessEnvironment(agent)
      );
      let sent: { status: number | null; stderr: string; stdout: string } | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        await delay(200);
        sent = await launch(service.getPath(), [
          '-hide_banner',
          '-loglevel',
          'error',
          '-re',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=1280x720:rate=30',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000',
          '-t',
          '4',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-g',
          '30',
          '-c:a',
          'aac',
          '-f',
          'flv',
          url,
        ]);
        if (sent.status === 0 || !/Connection refused|Error number -138/i.test(sent.stderr)) {
          break;
        }
      }
      const received = await receiver;
      const reports =
        process.env['MOARTUBE_GPU_REPORT_DIR'] ?? path.resolve('build/ffmpeg/reports/win32-x64');
      await fs.mkdir(reports, { recursive: true });
      await fs.writeFile(
        path.join(reports, `rtmp-${backend ?? 'unknown'}.txt`),
        `${JSON.stringify({ gpu, args }, null, 2)}\n${received.stderr}`
      );
      expect(sent?.status, sent?.stderr).toBe(0);
      expect(received.status, received.stderr).toBe(0);
      const probe = await launch(service.getProbePath(), [
        '-v',
        'error',
        '-show_streams',
        '-of',
        'json',
        output,
      ]);
      expect(probe.status, probe.stderr).toBe(0);
      const metadata = JSON.parse(probe.stdout) as {
        streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
      };
      expect(metadata.streams.find((stream) => stream.codec_type === 'video')).toMatchObject({
        codec_name: 'h264',
        width: 640,
        height: 360,
      });
      expect(metadata.streams.find((stream) => stream.codec_type === 'audio')).toMatchObject({
        codec_name: 'aac',
      });
      const decoded = await launch(service.getPath(), [
        '-v',
        'error',
        '-i',
        output,
        '-f',
        'null',
        '-',
      ]);
      expect(decoded.status, decoded.stderr).toBe(0);
    } finally {
      for (const child of children) {
        if (child.exitCode === null) {
          child.kill();
        }
      }
      await Promise.allSettled(pending);
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60000
);
