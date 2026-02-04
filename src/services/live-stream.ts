import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from 'pino';
import sharp from 'sharp';
import type { NodeApiService } from './node-api.js';
import type { S3Service } from './s3.js';
import type { StorageConfig } from '@/types/node-api.js';
import type { SettingsRepository } from '../database/repositories/settings.js';
import type { SocketService } from './socket.js';
import type { ManifestService } from './manifest.js';
import axios from 'axios';

interface StreamContext {
    accumulatedBuffer: Buffer;
    segmentCounter: number;
    nextExpectedSegmentIndex: number;
    endOfValidManifestPattern: Buffer;
    endOfValidManifestPatternLength: number;
}

interface SendSegmentOptions {
    jwtToken: string;
    videoId: string;
    resolution: string;
    manifestBuffer: Buffer;
    segmentBuffer: Buffer;
    manifestFileName: string;
    segmentFileName: string;
    storageConfig: StorageConfig;
    isCloudflareCdnEnabled: boolean;
    externalVideosBaseUrl: string;
}

interface HandleStreamDataOptions {
    data: Buffer;
    context: StreamContext;
    jwtToken: string;
    videoId: string;
    resolution: string;
    storageConfig: StorageConfig;
    isCloudflareCdnEnabled: boolean;
    externalVideosBaseUrl: string;
    isRecordingStreamLocally: boolean;
    isRecordingStreamRemotely: boolean;
    lengthTimestamp: string;
    format: string;
    sourceFilePath: string;
}

export class LiveStreamService {
    private readonly activeStreams: Map<string, { process?: ChildProcess, stopping: boolean }> = new Map();
    private ffmpegPath = 'ffmpeg';
    private uploadingImages = { thumbnail: false, preview: false, poster: false };
    private lastVideoImagesUpdateTimestamp = 0;

    constructor(
        private readonly logger: Logger,
        private readonly nodeApiService: NodeApiService,
        private readonly s3Service: S3Service,
        private readonly settingsRepository: SettingsRepository,
        private readonly socketService: SocketService,
        private readonly manifestService: ManifestService
    ) {}

    public setFfmpegPath(path: string): void {
        this.ffmpegPath = path;
    }

    public addProcessToLiveStreamTracker(videoId: string, process: ChildProcess): void {
        this.activeStreams.set(videoId, { process, stopping: false });
    }

    public isLiveStreamStopping(videoId: string): boolean {
        return this.activeStreams.get(videoId)?.stopping ?? false;
    }
    
    public liveStreamExists(videoId: string): boolean {
        return this.activeStreams.has(videoId);
    }
    
    public stopLiveStream(videoId: string): void {
        if (this.activeStreams.has(videoId)) {
            const stream = this.activeStreams.get(videoId); if (!stream) { return; }
            stream.stopping = true;
            if (stream.process) {stream.process.kill();}
        }
    }

    public async performStreamingJob(jwtToken: string, videoId: string, rtmpUrl: string, format: string, resolution: string, isRecordingStreamRemotely: boolean, isRecordingStreamLocally: boolean): Promise<void> {
        this.logger.info(`[LiveStreamService] Starting live stream for id: ${videoId}`);

        const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
        const storageConfig = nodeSettings.storageConfig;
        
        if (storageConfig === undefined) {
            this.logger.error(`[LiveStreamService] No storage configuration found for video ${videoId}`);
            return;
        }

        const isCloudflareCdnEnabled = nodeSettings.isCloudflareCdnEnabled ?? false;
        const videosPath = this.settingsRepository.getVideosDirectoryPath();

        if (storageConfig.s3Config !== undefined) {
            const prefix = `external/videos/${videoId}/adaptive/m3u8`;
            await this.s3Service.deleteDirectoryRecursive(storageConfig.s3Config, prefix); // Assuming implementation in S3Service
        }

        await this.manifestService.refreshMasterManifest(jwtToken, videoId);

        const videoDir = path.join(videosPath, videoId);
        await this.deleteDirectoryRecursive(videoDir);

        ['source', 'images', 'adaptive'].forEach(dir => fs.mkdirSync(path.join(videoDir, dir), { recursive: true }));

        const sourceFilePath = path.join(videoDir, 'source', `${videoId}.ts`);
        const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(jwtToken);
        
        const ffmpegArguments = this.generateFfmpegLiveArguments(videoId, resolution, format, rtmpUrl, isRecordingStreamRemotely, externalVideosBaseUrl);

        const process = spawn(this.ffmpegPath, ffmpegArguments);
        this.addProcessToLiveStreamTracker(videoId, process);

        let lengthSeconds = 0;
        let lengthTimestamp = '';
        
        const context: StreamContext = {
            accumulatedBuffer: Buffer.alloc(0),
            segmentCounter: -1,
            nextExpectedSegmentIndex: 0,
            endOfValidManifestPattern: Buffer.from(`segment-${resolution}-0.ts\n`),
            endOfValidManifestPatternLength: 0
        };
        context.endOfValidManifestPatternLength = context.endOfValidManifestPattern.length;

        process.stderr.on('data', (data: Buffer) => {
             if (!this.isLiveStreamStopping(videoId)) {
                const stderrTemp = Buffer.from(data).toString();
                if (stderrTemp.includes('time=')) {
                    const index = stderrTemp.indexOf('time=');
                    const timePart = stderrTemp.substring(index + 5);
                    lengthTimestamp = timePart.substring(0, 11);
                    lengthSeconds = this.timestampToSeconds(lengthTimestamp);
                    
                    void this.nodeApiService.setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp).catch(() => {});
                }
             }
        });

        process.stdout.on('data', (data: Buffer): void => {
          void (async (): Promise<void> => {
            if (!this.isLiveStreamStopping(videoId)) {
                 await this.handleStreamData({
                    data,
                    context,
                    jwtToken,
                    videoId,
                    resolution,
                    storageConfig,
                    isCloudflareCdnEnabled,
                    externalVideosBaseUrl,
                    isRecordingStreamLocally,
                    isRecordingStreamRemotely,
                    lengthTimestamp,
                    format,
                    sourceFilePath
                });
            }
          })();
        });

        process.on('exit', (code): void => {
             void (async (): Promise<void> => {
             this.logger.info(`[LiveStreamService] Stream process exited with code ${String(code)}`);
             if (this.liveStreamExists(videoId)) {
                 if (!this.isLiveStreamStopping(videoId)) {
                     // Stopped externally
                     this.socketService.broadcastToUser(jwtToken, 'echo', { eventName: 'video_status', payload: { type: 'streaming_stopping', videoId: videoId } });
                     // Handle cleanup/finalization similar to legacy
                     if (storageConfig.s3Config !== undefined) {
                         if (!isRecordingStreamRemotely) {
                              // cleanup S3
                         }
                     }
                     await this.nodeApiService.stopVideoStreaming(jwtToken, videoId);
                     this.socketService.broadcastToUser(jwtToken, 'echo', { eventName: 'video_status', payload: { type: 'streaming_stopped', videoId: videoId } });
                 }
                 this.activeStreams.delete(videoId);
             }
             })();
        });
    }

    private async handleStreamData(options: HandleStreamDataOptions): Promise<void> {
        const { data, context } = options;
        context.accumulatedBuffer = Buffer.concat([context.accumulatedBuffer, data]);

        if (this.isSegmentBoundary(data)) {
            const manifestIndex = context.accumulatedBuffer.indexOf('#EXTM3U');
            const startingSegmentIndex = context.accumulatedBuffer.indexOf('#EXT-X-MEDIA-SEQUENCE');

            if (manifestIndex !== -1 && startingSegmentIndex !== -1) {
                await this.processManifestAndSegment(manifestIndex, options);
            }
        }
    }

    private isSegmentBoundary(data: Buffer): boolean {
        return (data.at(-4) === 0x2E &&
               data.at(-3) === 0x74 &&
               data.at(-2) === 0x73 &&
               data.at(-1) === 0x0A);
    }

    private async processManifestAndSegment(manifestIndex: number, options: HandleStreamDataOptions): Promise<void> {
         const { context } = options;
         const manifestBuffer = context.accumulatedBuffer.subarray(manifestIndex);
         const segmentBuffer = context.accumulatedBuffer.subarray(0, manifestIndex);
         const manifestLines = manifestBuffer.toString().split('\n');

         for (const manifestLine of manifestLines) {
            if (manifestLine.includes('#EXT-X-MEDIA-SEQUENCE')) {
                context.segmentCounter = Number.parseInt(manifestLine.split(':')[1] ?? '0', 10);
                break;
            }
        }

        if (context.segmentCounter >= 0) {
            await this.finalizeSegmentProcessing(manifestLines, segmentBuffer, options);
        }
    }

    private async finalizeSegmentProcessing(manifestLines: string[], segmentBuffer: Buffer, options: HandleStreamDataOptions): Promise<void> {
        const { context, resolution, jwtToken, videoId, storageConfig, isCloudflareCdnEnabled, externalVideosBaseUrl, isRecordingStreamLocally, isRecordingStreamRemotely, lengthTimestamp, format, sourceFilePath } = options;
        
        let localCounter = context.segmentCounter;
        const segmentRegex = /(.*\/)(.*\.ts)$/;
            
        const updatedManifestLines = manifestLines.map(line => {
            if (segmentRegex.test(line.trim())) {
                const match = segmentRegex.exec(line.trim());
                if(match) {
                    const segmentPath = match[1] ?? '';
                    const newSegmentName = `segment-${resolution}-${String(localCounter)}.ts`;
                    const newSegmentPath = `${segmentPath}${newSegmentName}`;
                    localCounter++;
                    return newSegmentPath;
                }
            }
            return line;
        });
        
        const newManifestBuffer = Buffer.from(updatedManifestLines.join('\n'));
        const endOfValidManifestPatternIndex = newManifestBuffer.indexOf(context.endOfValidManifestPattern);
        
        if (endOfValidManifestPatternIndex !== -1 && ((newManifestBuffer.length - context.endOfValidManifestPatternLength) === endOfValidManifestPatternIndex)) {
            context.accumulatedBuffer = Buffer.alloc(0);
            context.nextExpectedSegmentIndex = localCounter;
            context.endOfValidManifestPattern = Buffer.from(`segment-${resolution}-${String(context.nextExpectedSegmentIndex)}.ts\n`);
            context.endOfValidManifestPatternLength = context.endOfValidManifestPattern.length;
            
            const currentSegmentCounter = localCounter - 1;
            const segmentFileName = `segment-${resolution}-${String(currentSegmentCounter)}.ts`;
            const manifestFileName = `manifest-${resolution}.m3u8`;

            await this.sendSegmentToNode({
                jwtToken, videoId, resolution, manifestBuffer: newManifestBuffer, segmentBuffer, manifestFileName, segmentFileName, storageConfig, isCloudflareCdnEnabled, externalVideosBaseUrl
            });
            this.sendImagesToNode(jwtToken, videoId, segmentBuffer, storageConfig);

            if (isRecordingStreamLocally) {
                fs.appendFileSync(sourceFilePath, segmentBuffer);
            }

            if (!isRecordingStreamRemotely && !isRecordingStreamLocally) {
                    const segmentIndexToRemove = currentSegmentCounter - 20;
                    if(segmentIndexToRemove >= 0) {
                    const segmentName = `segment-${resolution}-${String(segmentIndexToRemove)}.ts`;
                    if (storageConfig.storageMode === 'filesystem') {
                         void this.nodeApiService.removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName).catch(()=>{});
                    }
                    }
            }

            void this.nodeApiService.getVideoBandwidth(jwtToken, videoId).then(res => {
                if(!res.isError) {
                    this.socketService.broadcastToUser(jwtToken, 'echo', { 
                        eventName: 'video_status', 
                        payload: { type: 'streaming', videoId: videoId, lengthTimestamp: lengthTimestamp, bandwidth: res.bandwidth } 
                    });
                }
            });
        }
    }

    private async sendSegmentToNode(options: SendSegmentOptions): Promise<void> {
        const { jwtToken, videoId, resolution, manifestBuffer, segmentBuffer, manifestFileName, segmentFileName, storageConfig, isCloudflareCdnEnabled, externalVideosBaseUrl } = options;
        
        let processedManifestBuffer = manifestBuffer;

        if (isCloudflareCdnEnabled) {
             const lines = processedManifestBuffer.toString().split(/\r?\n/);
             if (lines.length >= 10) {
                 lines.splice(-3, 3);
                 processedManifestBuffer = Buffer.from(lines.join('\n'));
             }
        }

        if (storageConfig.storageMode === 'filesystem') {
             await this.nodeApiService.uploadStream(jwtToken, {
                videoId,
                format: 'm3u8',
                resolution,
                manifestBuffer: processedManifestBuffer,
                segmentBuffer,
                manifestFileName,
                segmentFileName
             }); 
        } else if (storageConfig.s3Config !== undefined) {
             const segmentKey = `external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/${segmentFileName}`;
             const manifestKey = `external/videos/${videoId}/adaptive/m3u8/dynamic/manifests/manifest-${resolution}.m3u8`;
             
             await this.s3Service.putObjectFromData(storageConfig.s3Config, segmentKey, segmentBuffer, 'video/mp2t');
             await this.s3Service.putObjectFromData(storageConfig.s3Config, manifestKey, processedManifestBuffer, 'application/vnd.apple.mpegurl');
        }

        if (isCloudflareCdnEnabled) {
            const segmentUrl = `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/${segmentFileName}`;
            void axios.get(segmentUrl).catch(() => {});
        }
    }

    private sendImagesToNode(jwtToken: string, videoId: string, segmentBuffer: Buffer, storageConfig: StorageConfig): void {
         if (!this.uploadingImages.thumbnail && !this.uploadingImages.preview && !this.uploadingImages.poster && (Date.now() - this.lastVideoImagesUpdateTimestamp > 10000)) {
            this.lastVideoImagesUpdateTimestamp = Date.now();
            const imagesDir = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId, 'images');
            const sourceImagePath = path.join(imagesDir, 'source.jpg');
            
            const process = spawn(this.ffmpegPath, ['-i', 'pipe:0', '-ss', '0.5', '-q', '18', '-frames:v', '1', '-y', sourceImagePath]);
            process.stdin.write(segmentBuffer);
            process.stdin.end();

        process.on('exit', (code): void => {
            void (async (): Promise<void> => {
                if(code === 0 && fs.existsSync(sourceImagePath)) {
                    try {
                        this.uploadingImages = { thumbnail: true, preview: true, poster: true };
                        const [thumbnail, preview, poster] = await Promise.all([
                            sharp(sourceImagePath).resize({ width: 100 }).resize(100, 100).jpeg({ quality: 90 }).toBuffer(),
                            sharp(sourceImagePath).resize({ width: 512 }).resize(512, 288).jpeg({ quality: 90 }).toBuffer(),
                            sharp(sourceImagePath).resize({ width: 1280 }).resize(1280, 720).jpeg({ quality: 90 }).toBuffer()
                        ]);

                        if (storageConfig.storageMode === 'filesystem') {
                             // Node API methods: setThumbnail, setPreview, setPoster
                             await this.nodeApiService.setThumbnail(jwtToken, videoId, thumbnail);
                             await this.nodeApiService.setPreview(jwtToken, videoId, preview);
                             await this.nodeApiService.setPoster(jwtToken, videoId, poster);
                        } else if (storageConfig.s3Config !== undefined) {
                             const s3Config = storageConfig.s3Config;
                             await this.s3Service.putObjectFromData(s3Config, `external/videos/${videoId}/images/thumbnail.jpg`, thumbnail, 'image/jpeg');
                             await this.s3Service.putObjectFromData(s3Config, `external/videos/${videoId}/images/preview.jpg`, preview, 'image/jpeg');
                             await this.s3Service.putObjectFromData(s3Config, `external/videos/${videoId}/images/poster.jpg`, poster, 'image/jpeg');
                        }
                    } catch(err) {
                        this.logger.error(err, `Failed to update images for live stream ${videoId}`);
                    } finally {
                        this.uploadingImages = { thumbnail: false, preview: false, poster: false };
                    }
                }
            })();
            });
         }
    }


    private generateFfmpegLiveArguments(videoId: string, resolution: string, format: string, rtmpUrl: string, isRecordingStreamRemotely: boolean, externalVideosBaseUrl: string): string[] {
        const clientSettings = this.settingsRepository.getClientSettings();
        let bitrate = '', gop = '', framerate = '', segmentLength = '';
        
        if (format === 'm3u8' && clientSettings.liveEncoderSettings !== undefined) {
             const liveEncoderSettings = clientSettings.liveEncoderSettings as unknown as { hls?: Record<string, string | number> };
             if (liveEncoderSettings.hls !== undefined) {
                 bitrate = String(liveEncoderSettings.hls[`${resolution}-bitrate`] ?? '') + 'k';
                 gop = String(liveEncoderSettings.hls['gop']);
                 framerate = String(liveEncoderSettings.hls['framerate']);
                 segmentLength = String(liveEncoderSettings.hls['segmentLength']);
             }
        }

        let args: string[] = [];
        // const hlsSegmentOutputPath = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts');

         if (clientSettings.processingAgent?.processingAgentType === 'cpu' && format === 'm3u8') {
            args = [
                '-listen', '1',
                '-timeout', '10000',
                '-f', 'flv',
                '-i', rtmpUrl,
                '-c:v', 'libx264', '-b:v', bitrate,
                '-sc_threshold', '0',
                '-g', gop,
                '-r', framerate,
                '-c:a', 'aac',
                '-f', 'hls',
                '-hls_time', segmentLength, '-hls_list_size', '20',
                '-hls_base_url', `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                '-hls_playlist_type', 'event',
                'pipe:1'
            ];
        }

        if (!isRecordingStreamRemotely) {
             const idx = args.indexOf('-hls_playlist_type');
             if(idx !== -1) {args.splice(idx, 2);}
        }

        return args;
    }

     private timestampToSeconds(timestamp: string): number {
        const parts = timestamp.split(':');
        const hours = Number.parseInt(parts[0] ?? '0', 10);
        const minutes = Number.parseInt(parts[1] ?? '0', 10);
        const seconds = Number.parseFloat(parts[2] ?? '0');
        return (hours * 3600) + (minutes * 60) + seconds;
    }

    private async deleteDirectoryRecursive(directoryPath: string): Promise<void> {
        try {
            await fs.promises.rm(directoryPath, { recursive: true, force: true });
        } catch (error) {
            this.logger.error(error, `failed to delete directory path: ${directoryPath}`);
        }
    }
}
