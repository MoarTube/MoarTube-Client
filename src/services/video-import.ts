import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { SettingsRepository } from '@/database/repositories/settings.js';
import type { BaseNodeResponse } from '@/types/node-api.js';
import type { NodeApiService } from './node-api.js';
// import type { NodeSocketService } from './node-socket.js';
import type { S3Service } from './s3.js';
import type { SocketService } from './socket.js';

export class VideoImportService extends BaseService {
  private readonly activeImports: Map<string, ChildProcess> = new Map();
  private readonly cancelledImports: Set<string> = new Set();

  constructor(
    logger: Logger,
    private readonly settingsRepository: SettingsRepository,
    private readonly nodeApiService: NodeApiService,
    private readonly socketService: SocketService,
    private readonly s3Service: S3Service
  ) {
    super('videoImportService', logger);
    sharp.cache(false);
  }

  private getFfmpegPath(): string {
      const settings = this.settingsRepository.getClientSettings();
      if (settings.ffmpegPath !== undefined && settings.ffmpegPath !== '') { return settings.ffmpegPath; }
      return (ffmpegStatic as unknown as string | null) ?? 'ffmpeg';
  }

  private timestampToSeconds(timestamp: string): number {
    const parts = timestamp.split(':');
    const hours = Number.parseInt(parts[0] ?? '0', 10);
    const minutes = Number.parseInt(parts[1] ?? '0', 10);
    const seconds = Number.parseFloat(parts[2] ?? '0');
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  private async runFfmpeg(videoId: string, args: string[]): Promise<string> {
      if (this.cancelledImports.has(videoId)) {
          throw new Error('Import cancelled');
      }

      return new Promise((resolve, reject) => {
          const ffmpegPath = this.getFfmpegPath();
          const process = spawn(ffmpegPath, args);
          
          this.activeImports.set(videoId, process);

          let stderr = '';
          
          process.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
          });

          process.on('close', (_code) => {
              this.activeImports.delete(videoId);
              
              if (this.cancelledImports.has(videoId)) {
                  reject(new Error('Import cancelled'));
                  return;
              }

              resolve(stderr); 
          });

          process.on('error', (err) => {
             this.activeImports.delete(videoId);
             reject(err);
          });
      });
  }

  private async generateImages(jwtToken: string, videoId: string, videoFilePath: string, imageExtractionTimestamp: number): Promise<void> {
      const imagesDirectoryPath = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId, 'images');
      fs.mkdirSync(imagesDirectoryPath, { recursive: true });

      const sourceImagePath = path.join(imagesDirectoryPath, 'source.jpg');
      
      await this.runFfmpeg(videoId, ['-ss', String(imageExtractionTimestamp), '-i', videoFilePath, '-vframes', '1', sourceImagePath]);

      if (this.cancelledImports.has(videoId)) {
          throw new Error('Import cancelled');
      }

      if (!fs.existsSync(sourceImagePath)) {
           this.logger.warn(`Failed to extract source image for ${videoId}`);
           return;
      } 
      
      const thumbnailBuffer = await sharp(sourceImagePath).resize({ width: 100, height: 100, fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
      const previewFileBuffer = await sharp(sourceImagePath).resize({ width: 512, height: 288, fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
      const posterFileBuffer = await sharp(sourceImagePath).resize({ width: 1280, height: 720, fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();

      if (this.cancelledImports.has(videoId)) {
           throw new Error('Import cancelled');
      }

      const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
      const storageConfig = nodeSettings.storageConfig;
      const storageMode = storageConfig?.storageMode;

      if (storageMode === 'filesystem') {
           await this.nodeApiService.setThumbnail(jwtToken, videoId, thumbnailBuffer);
           await this.nodeApiService.setPreview(jwtToken, videoId, previewFileBuffer);
           await this.nodeApiService.setPoster(jwtToken, videoId, posterFileBuffer);
      } else if (storageMode === 's3provider' && storageConfig?.s3Config) {
           const s3Config = storageConfig.s3Config;
           const thumbnailImageKey = `external/videos/${videoId}/images/thumbnail.jpg`;
           const previewImageKey = `external/videos/${videoId}/images/preview.jpg`;
           const posterImageKey = `external/videos/${videoId}/images/poster.jpg`;

           await this.s3Service.putObjectFromData(s3Config, thumbnailImageKey, thumbnailBuffer, 'image/jpeg');
           await this.s3Service.putObjectFromData(s3Config, previewImageKey, previewFileBuffer, 'image/jpeg');
           await this.s3Service.putObjectFromData(s3Config, posterImageKey, posterFileBuffer, 'image/jpeg');
      }
  }

  public async importVideo(jwtToken: string, videoId: string, videoFile: unknown): Promise<{ isError: boolean; message?: string }> {
      const file = videoFile as { path: string; mimetype: string } | undefined;

      if (file === undefined) {
          return { isError: true, message: 'video file is missing' };
      }

      const videoFilePath = file.path;
      const mimetype = file.mimetype;
      let sourceFileExtension = '';

      if (mimetype === 'video/mp4') {
          sourceFileExtension = '.mp4';
      } else if (mimetype === 'video/webm') {
          sourceFileExtension = '.webm';
      } else {
          return { isError: true, message: 'unexpected source file type: ' + mimetype };
      }

      this.cancelledImports.delete(videoId);

      try {
          const stderr = await this.runFfmpeg(videoId, ['-i', videoFilePath]);

          const durationIndex = stderr.indexOf('Duration: ');
          if (durationIndex === -1) {
              this.logger.warn(`Could not determine duration for video ${videoId}`);
          }
          
          const lengthTimestamp = durationIndex !== -1 ? stderr.substring(durationIndex + 10, durationIndex + 21) : '00:00:00.00';
          const lengthSeconds = this.timestampToSeconds(lengthTimestamp);
          const imageExtractionTimestamp = Math.floor(lengthSeconds * 0.25);

          this.logger.debug(`Video ${videoId}: Duration ${lengthTimestamp} (${String(lengthSeconds)}s)`);

          if (this.cancelledImports.has(videoId)) {
              throw new Error('Import cancelled');
          }

          await this.nodeApiService.setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp);
          await this.nodeApiService.setSourceFileExtension(jwtToken, videoId, sourceFileExtension);

          // Generate Images
          await this.generateImages(jwtToken, videoId, videoFilePath, imageExtractionTimestamp);

          if (this.cancelledImports.has(videoId)) {
              throw new Error('Import cancelled');
          }

          await this.nodeApiService.setVideoImported(jwtToken, videoId);
          
          this.socketService.broadcastToUser(jwtToken, 'echo', { 
            eventName: 'video_status', 
            payload: { type: 'imported', videoId: videoId, lengthTimestamp: lengthTimestamp } 
          });

          return { isError: false };

      } catch (error) {
          const err = error as Error;
          if (err.message === 'Import cancelled') {
             this.logger.info(`Import process for ${videoId} was cancelled cleanly.`);
             return { isError: true, message: 'Cancelled' };
          }
          this.logger.error('Import failed', error);
          return { isError: true, message: err.message };
      } finally {
          this.activeImports.delete(videoId);
          this.cancelledImports.delete(videoId);
          
          const imagesDirectoryPath = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId, 'images');
          try {
            await fs.promises.rm(imagesDirectoryPath, { recursive: true, force: true });
          } catch { /* ignore */ }
      }
  }

  public async stopImporting(jwtToken: string, videoId: string): Promise<BaseNodeResponse> {
       this.socketService.broadcastToUser(jwtToken, 'echo', { 
            eventName: 'video_status', 
            payload: { type: 'importing_stopping', videoId: videoId } 
       });

       this.stoppingVideoImport(videoId);

       const response = await this.nodeApiService.stopVideoImporting(jwtToken, videoId);

       if (!response.isError) {
             this.socketService.broadcastToUser(jwtToken, 'echo', { 
                eventName: 'video_status', 
                payload: { type: 'importing_stopped', videoId: videoId } 
           });
       }
       return response;
  }

  public stoppingVideoImport(videoId: string): void {
      this.logger.info(`Received stop import signal for ${videoId}`);
      this.cancelledImports.add(videoId);
      
      const process = this.activeImports.get(videoId);
      if (process) {
          this.logger.info(`Killing active ffmpeg process for ${videoId}`);
          process.kill('SIGKILL');
          this.activeImports.delete(videoId);
      }
  }

  public stoppedVideoImport(_videoId: string, data: unknown): void {
      this.socketService.broadcast('echo', data);
  }
}
