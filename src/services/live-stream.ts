import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from 'pino';
import sharp from 'sharp';
import type { NodeApiService } from './node-api.js';
import type { S3Service } from './s3.js';
import type { StorageConfig } from '@/types/node-api.js';
import type { SettingsRepository } from '../database/repositories/settings.js';
import type { SocketService } from './socket.js';
import type { ManifestService } from './manifest.js';
import axios from 'axios';

export class LiveStreamService {
    private activeStreams: Map<string, { process?: ChildProcess, stopping: boolean }> = new Map();
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
        const isCloudflareCdnEnabled = nodeSettings.isCloudflareCdnEnabled;
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
        let accumulatedBuffer = Buffer.alloc(0);
        const segmentRegex = /(.*\/)(.*\.ts)$/;
        let segmentCounter = -1; // Track locally
        let nextExpectedSegmentIndex = 0;
        let endOfValidManifestPattern = Buffer.from(`segment-${resolution}-${String(nextExpectedSegmentIndex)}.ts\n`);
        let endOfValidManifestPatternLength = endOfValidManifestPattern.length;


        process.stderr.on('data', (data: Buffer) => {
             if (!this.isLiveStreamStopping(videoId)) {
                const stderrTemp = Buffer.from(data).toString();
                if (stderrTemp.indexOf('time=') !== -1) {
                    const index = stderrTemp.indexOf('time=');
                    lengthTimestamp = stderrTemp.substring(index + 5, 11);
                    lengthSeconds = this.timestampToSeconds(lengthTimestamp);
                    
                    // Fire and forget update length
                    this.nodeApiService.setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp).catch(() => {});
                }
             }
        });

        /* eslint-disable-next-line @typescript-eslint/no-misused-promises */
        process.stdout.on('data', async (data: Buffer) => {
            if (!this.isLiveStreamStopping(videoId)) {
                accumulatedBuffer = Buffer.concat([accumulatedBuffer, data]);

                 if (data[data.length - 4] === 0x2E && // .
                    data[data.length - 3] === 0x74 && // t
                    data[data.length - 2] === 0x73 && // s
                    data[data.length - 1] === 0x0A) { // \n
                    
                    const manifestIndex = accumulatedBuffer.indexOf('#EXTM3U');
                    const startingSegmentIndex = accumulatedBuffer.indexOf('#EXT-X-MEDIA-SEQUENCE');

                    if (manifestIndex !== -1 && startingSegmentIndex !== -1) {
                        let manifestBuffer = accumulatedBuffer.subarray(manifestIndex);
                        const segmentBuffer = accumulatedBuffer.subarray(0, manifestIndex);

                        const manifestLines = manifestBuffer.toString().split('\n');
                        
                        // Parse segment counter from manifest
                         for (const manifestLine of manifestLines) {
                            if (manifestLine.includes('#EXT-X-MEDIA-SEQUENCE')) {
                                segmentCounter = parseInt(manifestLine.split(':')[1] ?? '0', 10);
                                break;
                            }
                        }

                        if (segmentCounter >= 0) {
                             // Fix manifest paths
                             let localCounter: number = segmentCounter; // Don't modify the one read from manifest for next loop? 
                             // Wait, legacy code increments this counter? No, it uses it to rename.
                             
                            const updatedManifestLines = manifestLines.map(line => {
                                if (segmentRegex.test(line.trim())) {
                                    const match = line.trim().match(segmentRegex);
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
                            
                            manifestBuffer = Buffer.from(updatedManifestLines.join('\n'));
                            const endOfValidManifestPatternIndex = manifestBuffer.indexOf(endOfValidManifestPattern);

                             if (endOfValidManifestPatternIndex !== -1 && ((manifestBuffer.length - endOfValidManifestPatternLength) === endOfValidManifestPatternIndex)) {
                                accumulatedBuffer = Buffer.alloc(0);
                                nextExpectedSegmentIndex = localCounter; // The loop incremented it
                                endOfValidManifestPattern = Buffer.from(`segment-${resolution}-${String(nextExpectedSegmentIndex)}.ts\n`);
                                endOfValidManifestPatternLength = endOfValidManifestPattern.length;
                                
                                // localCounter was incremented one past the last segment
                                const currentSegmentCounter: number = localCounter - 1;
                                const segmentFileName = 'segment-' + resolution + '-' + String(currentSegmentCounter) + '.ts';
                                const manifestFileName = 'manifest-' + resolution + '.m3u8';

                                await this.sendSegmentToNode(jwtToken, videoId, resolution, manifestBuffer, segmentBuffer, manifestFileName, segmentFileName, storageConfig, isCloudflareCdnEnabled, externalVideosBaseUrl);
                                this.sendImagesToNode(jwtToken, videoId, segmentBuffer, storageConfig);

                                if (isRecordingStreamLocally) {
                                    fs.appendFileSync(sourceFilePath, segmentBuffer);
                                }

                                if (!isRecordingStreamRemotely && !isRecordingStreamLocally) { // Legacy logic for cleanup
                                     const segmentIndexToRemove: number = (currentSegmentCounter - 20);
                                     if(segmentIndexToRemove >= 0) {
                                        const segmentName = `segment-${resolution}-${String(segmentIndexToRemove)}.ts`;
                                        if (storageConfig.storageMode === 'filesystem') {
                                            this.nodeApiService.removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName).catch(()=>{});
                                        } else if (storageConfig.s3Config !== undefined) {
                                             // const segmentKey = `external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/${segmentName}`;
                                             // this.s3Service.deleteObjectWithKey(storageConfig.s3Config, segmentKey).catch(()=>{});
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
                    }
                }
            }
        });

        /* eslint-disable-next-line @typescript-eslint/no-misused-promises */
        process.on('exit', async (code) => {
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
        });
    }

    private async sendSegmentToNode(jwtToken: string, videoId: string, resolution: string, manifestBuffer: Buffer, segmentBuffer: Buffer, manifestFileName: string, segmentFileName: string, storageConfig: StorageConfig, isCloudflareCdnEnabled: boolean, externalVideosBaseUrl: string): Promise<void> {
        
        if (isCloudflareCdnEnabled) {
             const lines = manifestBuffer.toString().split(/\r?\n/);
             if (lines.length >= 10) {
                 lines.splice(lines.length - 3, 3);
                 manifestBuffer = Buffer.from(lines.join('\n'));
             }
        }

        if (storageConfig.storageMode === 'filesystem') {
             await this.nodeApiService.uploadStream(jwtToken, videoId, 'm3u8', resolution, manifestBuffer, segmentBuffer, manifestFileName, segmentFileName); // Need to add uploadStream to NodeApiService
        } else if (storageConfig.s3Config !== undefined) {
             const segmentKey = `external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/${segmentFileName}`;
             const manifestKey = `external/videos/${videoId}/adaptive/m3u8/dynamic/manifests/manifest-${resolution}.m3u8`;
             
             await this.s3Service.putObjectFromData(storageConfig.s3Config, segmentKey, segmentBuffer, 'video/mp2t');
             await this.s3Service.putObjectFromData(storageConfig.s3Config, manifestKey, manifestBuffer, 'application/vnd.apple.mpegurl');
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

            /* eslint-disable-next-line @typescript-eslint/no-misused-promises */
        process.on('exit', async (code) => {
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
            });
         }
    }


    private generateFfmpegLiveArguments(videoId: string, resolution: string, format: string, rtmpUrl: string, isRecordingStreamRemotely: boolean, externalVideosBaseUrl: string): string[] {
        const clientSettings = this.settingsRepository.getClientSettings();
        let bitrate = '', gop = '', framerate = '', segmentLength = '';
        
        if (format === 'm3u8' && clientSettings.liveEncoderSettings) {
             const liveEncoderSettings: { hls: Record<string, string | number> } = clientSettings.liveEncoderSettings;
             bitrate = String((liveEncoderSettings.hls)[resolution + '-bitrate'] ?? '') + 'k';
             gop = String(liveEncoderSettings.hls.gop);
             framerate = String(liveEncoderSettings.hls.framerate);
             segmentLength = String(liveEncoderSettings.hls.segmentLength);
        }

        let args: string[] = [];
        // const hlsSegmentOutputPath = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts');

         if (clientSettings.processingAgent.processingAgentType === 'cpu' && format === 'm3u8') {
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
        const hours = parseInt(parts[0] ?? '0');
        const minutes = parseInt(parts[1] ?? '0');
        const seconds = parseFloat(parts[2] ?? '0');
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
