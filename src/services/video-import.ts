import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
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
      if (settings.ffmpegPath !== '') { return settings.ffmpegPath; }
      return (ffmpegStatic as unknown as string | null) ?? 'ffmpeg';
  }

  private timestampToSeconds(timestamp: string): number {
    const parts = timestamp.split(':');
    const hours = parseInt(parts[0] ?? '0');
    const minutes = parseInt(parts[1] ?? '0');
    const seconds = parseFloat(parts[2] ?? '0');
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  public async importVideo(jwtToken: string, videoId: string, videoFile: unknown): Promise<{ isError: boolean; message?: string }> {
      // videoFile is expected to be the object from fastify-multipart (file properies)
      // Actually fastify-multipart 'file' event gives a stream. 'files' in body gives access if using attachFieldsToBody: true, but standard is different.
      // Legacy Code: `videoFile = req.files['videoFile'][0];` - Express Multer style.
      // Fastify multipart: `part` object for stream, or if `addToBody: true` (which I think I set? or default is false). 
      // User legacy code suggests `videoFile` has `.path`. This implies it's saved to disk?
      // Fastify multipart `attachFieldsToBody: true` handles small files. But videos?
      // `app.register(fastifyMultipart, { limits: { fileSize: 10GB } })` 
      // If `attachFieldsToBody` is NOT set, we handle stream.
      // BUT legacy code uses `videoFile.path`. This implies the file is on disk.
      // Express Multer with `dest` option saves to disk.
      // Fastify multipart usually streams. To define `path`, we need to save it to a temp file, OR use `fastify-multipart`'s `attachFieldsToBody` with a custom handler?
      // Given `MoarTube-Client` is a desktop-like client, likely saving to temp is fine.
      // Assuming the controller handles saving to temp path and passes `{ path: ... }` to service.
      
      const file = videoFile as { path: string; mimetype: string } | undefined;

      if (file === undefined) {
          return { isError: true, message: 'video file is missing' };
      }

      const videoFilePath = file.path; // Assumed standard interface from controller
      const mimetype = file.mimetype;
      let sourceFileExtension = '';

      if (mimetype === 'video/mp4') {
          sourceFileExtension = '.mp4';
      } else if (mimetype === 'video/webm') {
          sourceFileExtension = '.webm';
      } else {
          return { isError: true, message: 'unexpected source file type: ' + mimetype };
      }

      try {
          const ffmpegPath = this.getFfmpegPath();
          const output = spawnSync(ffmpegPath, ['-i', videoFilePath], { encoding: 'utf-8' });
          const stderr = output.stderr || '';

          const durationIndex = stderr.indexOf('Duration: ');
          if (durationIndex === -1) {
              // Could not determine duration
              this.logger.warn(`Could not determine duration for video ${videoId}`);
          }
          
          const lengthTimestamp = durationIndex !== -1 ? stderr.substring(durationIndex + 10, durationIndex + 21) : '00:00:00.00';
          const lengthSeconds = this.timestampToSeconds(lengthTimestamp);
          const imageExtractionTimestamp = Math.floor(lengthSeconds * 0.25);

          this.logger.debug(`Video ${videoId}: Duration ${lengthTimestamp} (${String(lengthSeconds)}s)`);

          await this.nodeApiService.setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp);
          await this.nodeApiService.setSourceFileExtension(jwtToken, videoId, sourceFileExtension);

          // Generate Images
          const imagesDirectoryPath = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId, 'images');
          fs.mkdirSync(imagesDirectoryPath, { recursive: true });

          const sourceImagePath = path.join(imagesDirectoryPath, 'source.jpg');
          
          spawnSync(ffmpegPath, ['-ss', String(imageExtractionTimestamp), '-i', videoFilePath, '-vframes', '1', sourceImagePath]);

          if (!fs.existsSync(sourceImagePath)) {
               this.logger.warn(`Failed to extract source image for ${videoId}`);
          } else {
               const thumbnailBuffer = await sharp(sourceImagePath).resize({ width: 100, height: 100, fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
               const previewFileBuffer = await sharp(sourceImagePath).resize({ width: 512, height: 288, fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
               const posterFileBuffer = await sharp(sourceImagePath).resize({ width: 1280, height: 720, fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();

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

          // Cleanup images
          try {
            await fs.promises.rm(imagesDirectoryPath, { recursive: true, force: true });
          } catch { /* ignore */ }

          await this.nodeApiService.setVideoImported(jwtToken, videoId);
          
          this.socketService.broadcastToUser(jwtToken, 'echo', { 
            eventName: 'video_status', 
            payload: { type: 'imported', videoId: videoId, lengthTimestamp: lengthTimestamp } 
          });

          return { isError: false };

      } catch (error) {
          this.logger.error('Import failed', error);
          return { isError: true, message: (error as Error).message };
      }
  }

  public async stopImporting(jwtToken: string, videoId: string): Promise<BaseNodeResponse> {
       this.socketService.broadcastToUser(jwtToken, 'echo', { 
            eventName: 'video_status', 
            payload: { type: 'importing_stopping', videoId: videoId } 
       });

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
      // Placeholder: If we were tracking active imports processes, we would kill it here.
      // Current implementation uses spawnSync which cannot be interrupted easily from here.
      // TODO: Refactor importVideo to use spawn() and track processes.
      this.logger.info(`Received stop import signal for ${videoId}`);
  }

  public stoppedVideoImport(_videoId: string, data: unknown): void {
      // Broadcast to user that it's stopped
      // We need a JWT token? Data usually has event info. 
      // Legacy: socketService.broadcastToUser(??, 'echo', data);
      // 'data' param comes from NodeSocketService's message.
      // We can just broadcast 'echo' with data.
      this.socketService.broadcast('echo', data);
  }
}
