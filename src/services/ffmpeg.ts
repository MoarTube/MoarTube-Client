/**
 * FFmpeg Service
 *
 * Single source of truth for the FFmpeg executable path.
 * Resolves the path using the following priority:
 *   1. Client settings (`ffmpegPath` in _client_settings.json)
 *   2. FFMPEG_BIN environment override
 *   3. Locally compiled binary for this OS and architecture
 *   4. Verified MoarTube resource artifact
 *
 * Legacy equivalent: helpers.js getFfmpegPath / setFfmpegPath
 */
import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { Config } from '@/config/index.js';
import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { detectSystemGpus, getGpuProcessEnvironment, type DetectedGpu } from '@/utils/hardware.js';
import { getGpuProbeArguments } from '@/utils/gpu-encoding.js';
import { GPU_PROBE_H264 } from '@/utils/gpu-probe.js';
import { resolveFfmpegBinaries, type FfmpegBinaries } from '@/utils/ffmpeg-path.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { trackMediaProcess } from '@/utils/media-processes.js';

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
    return this.getBinaries().ffmpeg;
  }

  private getBinaries(): FfmpegBinaries {
    const resources = process.env['MOARTUBE_RESOURCE_ROOT'];
    return resolveFfmpegBinaries({
      root: (this.config as Partial<Config>).paths?.root,
      // An explicit empty value keeps Electron development on the local build.
      resourceRoot:
        process.env['MOARTUBE_DESKTOP_MODE'] === 'development' || resources === ''
          ? undefined
          : (resources ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath),
      ffmpegPath: this.config.clientSettings.ffmpegPath,
    });
  }

  public getProbePath(): string {
    return this.getBinaries().ffprobe;
  }

  public async getDiagnostics(): Promise<{
    path: string;
    version: string;
    buildId: string | undefined;
  }> {
    const binaries = this.getBinaries();
    const executable = binaries.ffmpeg;
    const result = run(executable, ['-version'], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 128 * 1024,
    });
    trackMediaProcess((result as typeof result & { child?: ChildProcess }).child);
    const { stdout } = await result;
    return {
      path: executable,
      version: stdout.split(/\r?\n/)[0] ?? '',
      buildId: binaries.buildId,
    };
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
          const probe = run(executable, getGpuProbeArguments(agent, sourcePath), {
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 128 * 1024,
            env: getGpuProcessEnvironment(agent),
          });
          trackMediaProcess((probe as typeof probe & { child?: ChildProcess }).child);
          await probe;
          results.push({ ...gpu, available: true });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.logger.warn(`FFmpeg GPU probe failed for ${gpu.id}: ${detail.slice(0, 3000)}`);
          results.push({
            ...gpu,
            available: false,
            unavailableReason:
              gpu.backend === 'amf'
                ? 'AMD could not decode, scale and encode video in hardware. Check the selected adapter and an FFmpeg build with vpp_amf and h264_amf hardware-surface support.'
                : gpu.backend === 'videotoolbox'
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
