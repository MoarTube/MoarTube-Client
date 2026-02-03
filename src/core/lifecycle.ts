import fs from 'node:fs/promises';
import path from 'node:path';
import systeminformation from 'systeminformation';
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
     
     // streamsTrackerService might need eager loading if it has intervals, but usually it's reactive.
     // legacy main.js didn't seemingly start a streams interval, just videoPublish.
     
     this.logger.info('[LifecycleManager] Startup tasks completed.');
  }

  private async performEncodingDecodingAssessment(): Promise<void> {
        this.logger.debug('Assessing system encoding/decoding capabilities');
        try {
            const cpu = await systeminformation.cpu();
            const gpu = await systeminformation.graphics();

            const cpuName = `${cpu.manufacturer} ${cpu.brand}`.trim();
            let gpuName = 'none';

            if (gpu.controllers.length > 0) {
                 // Try to find a non-Intel/integrated if possible, or just list first
                 const controller = gpu.controllers.find(c => !c.vendor.toLowerCase().includes('intel')) ?? gpu.controllers[0];
                 if (controller) {
                    gpuName = `${controller.vendor} ${controller.model}`.trim();
                 }
            }

            this.logger.info(`CPU Detected: ${cpuName}`);
            this.logger.info(`GPU Detected: ${gpuName}`);
        } catch (error) {
            this.logger.warn('Failed to assess system hardware', error);
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
               
                if (!stat.isDirectory()) {continue;}
 
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
