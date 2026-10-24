import fs from 'node:fs/promises';
import path from 'node:path';
import { detectSystemCpu, detectSystemGpus } from '@/utils/hardware.js';
import type { Container } from '@/core/container.js';
import type { Logger } from '@/utils/logger.js';

export class LifecycleManager {
  private readonly logger: Logger;

  constructor(private readonly container: Container) {
    this.logger = container.resolve('logger');
  }

  public async onStartup(): Promise<void> {
    this.logger.info('[LifecycleManager] Running startup tasks...');

    await this.performEncodingDecodingAssessment();
    await this.cleanVideosDirectory();

    // Eager load background services
    this.container.resolve('videoPublishService');

    this.logger.info('[LifecycleManager] Startup tasks completed.');
  }

  private async performEncodingDecodingAssessment(): Promise<void> {
    this.logger.debug('Assessing system encoding/decoding capabilities');
    try {
      const cpu = await detectSystemCpu();
      const gpus = await detectSystemGpus();
      this.logger.info(`CPU Detected: ${cpu.processingAgentModel}`);
      if (gpus.length === 0) {
        this.logger.info('Compatible GPUs Detected: none');
      }
      for (const gpu of gpus) {
        this.logger.info(
          `GPU Detected: ${gpu.processingAgentName} ${gpu.processingAgentModel} (${gpu.id})`
        );
      }

      const config = this.container.resolve('config');
      const agent = config.clientSettings.processingAgent;
      const selectedGpu =
        process.platform === 'win32' && agent?.processingAgentType === 'gpu'
          ? gpus.find((gpu) => gpu.id === agent.gpuId)
          : undefined;
      // Legacy selections did not identify a device. Require an explicit choice.
      if (agent?.processingAgentType === 'gpu') {
        config.saveClientSettings({
          processingAgent: selectedGpu
            ? {
                processingAgentType: 'gpu',
                processingAgentName: selectedGpu.processingAgentName,
                processingAgentModel: selectedGpu.processingAgentModel,
                gpuId: selectedGpu.id,
                deviceIndex: selectedGpu.deviceIndex,
                deviceUuid: selectedGpu.deviceUuid,
              }
            : { processingAgentType: 'cpu', ...cpu },
        });
      }
      this.logger.info(
        selectedGpu
          ? `Encoding GPU Selected: ${selectedGpu.processingAgentName} ${selectedGpu.processingAgentModel}`
          : process.platform !== 'win32'
            ? 'GPU acceleration is only supported on Windows. Using CPU encoding.'
            : 'GPU acceleration disabled (CPU). Select a GPU in Client Settings to enable it.'
      );
    } catch (error) {
      this.logger.warn('Failed to assess system hardware; using CPU', error);
      this.container.resolve('config').saveClientSettings({
        processingAgent: { processingAgentType: 'cpu', processingAgentName: 'CPU' },
      });
    }
  }

  private async cleanVideosDirectory(): Promise<void> {
    this.logger.debug('Cleaning imported video directories');
    const settingsRepo = this.container.resolve('settingsRepository');
    const videosDir = settingsRepo.getVideosDirectoryPath();

    try {
      await fs.access(videosDir);
    } catch {
      // Directory doesn't exist yet, nothing to clean
      return;
    }

    try {
      const videoDirs = await fs.readdir(videosDir);
      for (const videoId of videoDirs) {
        const videoPath = path.join(videosDir, videoId);
        try {
          const stat = await fs.stat(videoPath);

          if (!stat.isDirectory()) {
            continue;
          }

          const subDirs = await fs.readdir(videoPath);
          for (const subDir of subDirs) {
            if (subDir !== 'source') {
              const subDirPath = path.join(videoPath, subDir);
              // this.logger.debug(`Deleting directory: ${subDirPath}`);
              await fs.rm(subDirPath, { recursive: true, force: true });
            }
          }
        } catch {
          // Ignore access errors on individual files
        }
      }
    } catch (error) {
      this.logger.error('Error cleaning videos directory', error);
    }
  }
}
