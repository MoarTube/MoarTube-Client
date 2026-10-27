/**
 * FFmpeg Service
 *
 * Single source of truth for the FFmpeg executable path.
 * Resolves the path using the following priority:
 *   1. Client settings (`ffmpegPath` in _client_settings.json)
 *   2. Bundled ffmpeg-static binary
 *   3. System PATH fallback (`ffmpeg`)
 *
 * Legacy equivalent: helpers.js getFfmpegPath / setFfmpegPath
 */
import ffmpegStatic from 'ffmpeg-static';
import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { Config } from '@/config/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectSystemGpus, getGpuProcessEnvironment, type DetectedGpu } from '@/utils/hardware.js';
import { getGpuProbeArguments } from '@/utils/gpu-encoding.js';
import { GPU_PROBE_H264 } from '@/utils/gpu-probe.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const run = promisify(execFile);

export interface GpuCapability extends DetectedGpu {
  available: boolean;
  unavailableReason?: string;
}

export class FfmpegService extends BaseService {
  private readonly config: Config;
  private gpuAssessment:
    | { path: string; expires: number; result: Promise<GpuCapability[]> }
    | undefined;

  constructor(logger: Logger, config: Config) {
    super('ffmpegService', logger);
    this.config = config;
  }

  /**
   * Get the resolved FFmpeg executable path.
   *
   * Re-evaluated on every call so that a settings-file change
   * (picked up by Config's file watcher) takes effect immediately.
   */
  public getPath(): string {
    // 1. Explicit path from client settings
    const settingsPath = this.config.clientSettings.ffmpegPath;
    if (settingsPath !== undefined && settingsPath !== '') {
      return settingsPath;
    }

    // 2. Bundled ffmpeg-static binary
    const staticPath = ffmpegStatic as unknown as string | null;
    if (staticPath !== null) {
      return staticPath;
    }

    // 3. System PATH fallback
    return 'ffmpeg';
  }

  /** Verify compressed-video decoding, filtering and encoding on the selected GPU. */
  public assessGpus(refresh = false): Promise<GpuCapability[]> {
    const executable = this.getPath();
    const cached = this.gpuAssessment;
    if (!refresh && cached?.path === executable && cached.expires > Date.now()) {
      return cached.result;
    }
    const result = this.probeGpus(executable);
    this.gpuAssessment = { path: executable, expires: Date.now() + 30000, result };
    return result;
  }

  private async probeGpus(executable: string): Promise<GpuCapability[]> {
    const devices = await detectSystemGpus();
    const results: GpuCapability[] = [];
    if (devices.length === 0) {
      return results;
    }
    const probeDirectory = await fs.mkdtemp(path.join(tmpdir(), 'moartube-gpu-'));
    const sourcePath = path.join(probeDirectory, 'probe.h264');
    try {
      await fs.writeFile(sourcePath, GPU_PROBE_H264);
      // Probe serially to avoid consuming several encoder sessions at once.
      for (const gpu of devices) {
        const agent = { ...gpu, processingAgentType: 'gpu' };
        try {
          await run(executable, getGpuProbeArguments(agent, sourcePath), {
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 128 * 1024,
            env: getGpuProcessEnvironment(agent),
          });
          results.push({ ...gpu, available: true });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.logger.warn(`FFmpeg GPU probe failed for ${gpu.id}: ${detail.slice(0, 3000)}`);
          results.push({
            ...gpu,
            available: false,
            unavailableReason:
              gpu.backend === 'videotoolbox'
                ? 'VideoToolbox could not decode, scale and encode video. Use native macOS and an FFmpeg build with VideoToolbox and scale_vt support.'
                : gpu.backend === 'qsv'
                  ? 'Intel Quick Sync could not decode, scale and encode video. Check the selected adapter and FFmpeg QSV decoder, vpp_qsv and h264_qsv support.'
                  : 'FFmpeg could not decode, process and encode video on this GPU. Check hardware support, drivers and device permissions.',
          });
        }
      }
    } finally {
      // Remove only our fixed file and empty temporary directory.
      await fs.rm(sourcePath, { force: true });
      await fs.rmdir(probeDirectory);
    }
    return results;
  }
}
