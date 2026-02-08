import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from 'pino';
import ffmpegStatic from 'ffmpeg-static';
import type { NodeApiService } from './node-api.js';
import type { S3Service, S3ValidationConfig } from './s3.js';
import type { SettingsRepository } from '../database/repositories/settings.js';
import type { SocketService } from './socket.js';
import type { ManifestService } from './manifest.js';

interface VideoPublishJob {
    jwtToken: string;
    videoId: string;
    format: 'm3u8' | 'mp4' | 'webm' | 'ogv';
    resolution: string;
    sourceFileExtension: string;
    idleInterval?: NodeJS.Timeout;
}

export class VideoPublishService {
    private inProgressPublishingJobCount = 0;
    private maximumInProgressPublishingJobCount = 5;
    private readonly inProgressPublishingJobs: VideoPublishJob[] = [];
    private readonly pendingPublishVideoQueue: VideoPublishJob[] = [];
    private readonly activeEncodingJobs: Map<string, { stopping: boolean, process?: ChildProcess }> = new Map();
    private ffmpegPath = (ffmpegStatic as unknown as string | null) ?? 'ffmpeg';

    constructor(
        private readonly logger: Logger,
        private readonly nodeApiService: NodeApiService,
        private readonly s3Service: S3Service,
        private readonly settingsRepository: SettingsRepository,
        private readonly socketService: SocketService,
        private readonly manifestService: ManifestService
    ) {
        this.startVideoPublishInterval();
    }

    public setFfmpegPath(path: string): void {
        this.ffmpegPath = path;
    }

    public enqueuePendingPublishVideo(job: VideoPublishJob): void {
        this.pendingPublishVideoQueue.push(job);
        this.logger.info(`[VideoPublishService] Enqueued job for video ${job.videoId}`);
    }

    public stopPendingPublishVideo(videoId: string): void {
        const index = this.pendingPublishVideoQueue.findIndex(job => job.videoId === videoId);
        if (index !== -1) {
            const job = this.pendingPublishVideoQueue[index];
            if (job?.idleInterval) {
                clearInterval(job.idleInterval);
            }
            this.pendingPublishVideoQueue.splice(index, 1);
            this.logger.info(`[VideoPublishService] Removed pending job for video ${videoId}`);
        }
    }

    public isPublishVideoEncodingStopping(videoId: string): boolean {
        return this.activeEncodingJobs.get(videoId)?.stopping ?? false;
    }

    public stoppingPublishVideoEncoding(videoId: string): void {
        const job = this.activeEncodingJobs.get(videoId);
        if (job) {
            job.stopping = true;
            if (job.process) {
                job.process.kill();
            }
            this.logger.info(`[VideoPublishService] Stopping encoding for video ${videoId}`);
        }
    }

    private startVideoPublishInterval(): void {
        setInterval(() => {
            while (this.pendingPublishVideoQueue.length > 0 && this.inProgressPublishingJobCount < this.maximumInProgressPublishingJobCount) {
                this.inProgressPublishingJobCount++;
                const job = this.pendingPublishVideoQueue.shift();

                if (job) {
                    this.inProgressPublishingJobs.push(job);
                    this.startPublishingJob(job)
                        .then(async () => {
                            await this.nodeApiService.setVideoFormatResolutionPublished(job.jwtToken, job.videoId, job.format, job.resolution);
                            
                            this.logger.info(`[VideoPublishService] Video finished publishing: ${job.videoId} ${job.format} ${job.resolution}`);

                            const index = this.findInProgressPublishJobIndex(job);
                            if (index !== -1) {this.inProgressPublishingJobs.splice(index, 1);}

                            const videoIdHasPending = this.pendingPublishVideoQueue.some(p => p.videoId === job.videoId);
                            const videoIdHasInProgress = this.inProgressPublishingJobs.some(p => p.videoId === job.videoId);

                            if (job.format === 'm3u8') {
                                try {
                                    await this.manifestService.refreshMasterManifest(job.jwtToken, job.videoId);
                                } catch (error) {
                                    this.logger.error(error, `[VideoPublishService] Failed to refresh/upload manifest for video ${job.videoId}`);
                                }
                            }

                            if (!videoIdHasPending && !videoIdHasInProgress) {
                                await this.finishVideoPublish(job.jwtToken, job.videoId);
                                this.logger.info(`[VideoPublishService] Completed publishing job for video: ${job.videoId}`);
                            }

                            this.inProgressPublishingJobCount--;

                            if (this.inProgressPublishingJobCount === 0 && this.pendingPublishVideoQueue.length === 0) {
                                this.maximumInProgressPublishingJobCount = 5;
                            }
                        })
                        .catch((error: any) => {
                            this.logger.error({ err: error, errMsg: error.message, stack: error.stack }, `[VideoPublishService] Failed publishing job: ${job.videoId}`);
                            
                            const index = this.findInProgressPublishJobIndex(job);
                            if (index !== -1) {this.inProgressPublishingJobs.splice(index, 1);}

                            if (!this.isPublishVideoEncodingStopping(job.videoId)) {
                                job.idleInterval = setInterval(() => {
                                    this.socketService.broadcastToUser(job.jwtToken, 'echo', { 
                                        eventName: 'video_status', 
                                        payload: { type: 'publishing', videoId: job.videoId, format: job.format, resolution: job.resolution, progress: 0 } 
                                    });
                                }, 1000);

                                this.enqueuePendingPublishVideo(job);

                                if (this.maximumInProgressPublishingJobCount > 1) {
                                    this.maximumInProgressPublishingJobCount--;
                                }
                            }

                            this.inProgressPublishingJobCount--;
                        });
                }
            }
        }, 3000);
    }

    private findInProgressPublishJobIndex(job: VideoPublishJob): number {
        return this.inProgressPublishingJobs.findIndex(j => 
            j.videoId === job.videoId && j.format === job.format && j.resolution === job.resolution
        );
    }

    private async startPublishingJob(job: VideoPublishJob): Promise<void> {
        if (job.idleInterval) {clearInterval(job.idleInterval);}

        const response = await this.nodeApiService.setVideoPublishing(job.jwtToken, job.videoId) as { isError: boolean };
        if (!response.isError) {
            this.activeEncodingJobs.set(job.videoId, { stopping: false });
            
            await this.performEncodingJob(job);
            await this.performUploadingJob(job);

            this.activeEncodingJobs.delete(job.videoId);
        }
    }

    private async performEncodingJob(job: VideoPublishJob): Promise<void> {
        if (this.isPublishVideoEncodingStopping(job.videoId)) {
            throw new Error(`${job.videoId} attempted to encode but publishing is stopping`);
        }

        const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(job.jwtToken);
        const videosPath = this.settingsRepository.getVideosDirectoryPath();
        const sourceFilePath = path.join(videosPath, job.videoId, 'source', job.videoId + job.sourceFileExtension);
        const destinationFilePath = this.prepareDestinationDirectory(videosPath, job);

        const ffmpegArguments = this.generateFfmpegVideoArguments(job.videoId, job.resolution, job.format, sourceFilePath, destinationFilePath, job.sourceFileExtension, externalVideosBaseUrl);

        return new Promise((resolve, reject) => {
            this.logger.info(`[VideoPublishService] Spawning ffmpeg: ${this.ffmpegPath} with args: ${ffmpegArguments.join(' ')}`);
            
            const process = spawn(this.ffmpegPath, ffmpegArguments);
            
            process.on('error', (err) => {
                 this.logger.error(err, `[VideoPublishService] Failed to spawn ffmpeg for job ${job.videoId}`);
                 reject(err);
            });

            const activeJob = this.activeEncodingJobs.get(job.videoId);
            if (activeJob) {activeJob.process = process;}

            this.monitorEncodingProcess(process, job, resolve, reject);
        });
    }

    private prepareDestinationDirectory(videosPath: string, job: VideoPublishJob): string {
        const destinationFileExtension = '.' + job.format;
        const ensureDir = (p: string): void => { if (!fs.existsSync(p)) {fs.mkdirSync(p, { recursive: true });} };

        if (job.format === 'm3u8') {
            ensureDir(path.join(videosPath, job.videoId, 'adaptive', 'm3u8', job.resolution));
            return path.join(videosPath, job.videoId, 'adaptive', 'm3u8', 'manifest-' + job.resolution + destinationFileExtension);
        }
        
        const subDir = job.format; 
        ensureDir(path.join(videosPath, job.videoId, 'progressive', subDir));
        return path.join(videosPath, job.videoId, 'progressive', subDir, job.resolution + destinationFileExtension);
    }

    private monitorEncodingProcess(process: ChildProcess, job: VideoPublishJob, resolve: () => void, reject: (err: Error) => void): void {
        process.stdout?.on('data', () => { /* Prevent buffer overflow */ });

        let lengthTimestamp = '00:00:00.00';
        let lengthSeconds = 0;
        let stderrOutput = '';

        process.stderr?.on('data', (data) => {
            if (this.isPublishVideoEncodingStopping(job.videoId)) {
                process.kill();
                return;
            }

            const stderrTemp = Buffer.from(data).toString();
            
            if (stderrTemp.includes('time=')) {
                 if (lengthSeconds === 0) {
                    const index = stderrOutput.indexOf('Duration: ');
                    if(index !== -1) {
                        lengthTimestamp = stderrOutput.substring(index + 10, index + 10 + 11);
                        lengthSeconds = this.timestampToSeconds(lengthTimestamp);
                    }
                }

                const index = stderrTemp.indexOf('time=');
                const currentTimestamp = stderrTemp.substring(index + 5, index + 5 + 11);
                const currentTimeSeconds = this.timestampToSeconds(currentTimestamp);

                if (currentTimeSeconds > 0 && lengthSeconds > 0) {
                    const encodingProgress = Math.ceil(((currentTimeSeconds / lengthSeconds) * 100) / 2);
                    this.socketService.broadcastToUser(job.jwtToken, 'echo', { 
                        eventName: 'video_status', 
                        payload: { type: 'publishing', videoId: job.videoId, format: job.format, resolution: job.resolution, progress: encodingProgress } 
                    });
                }
            } else {
                stderrOutput += stderrTemp;
            }
        });

        process.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`encoding process ended with an error code: ${code}. stderr: ${stderrOutput}`));
            }
        });
    }

    private async performUploadingJob(job: VideoPublishJob): Promise<void> {
        if (!this.isPublishVideoEncodingStopping(job.videoId)) {
            const nodeSettings = await this.nodeApiService.getNodeSettings(job.jwtToken);
            const videosPath = this.settingsRepository.getVideosDirectoryPath();

            if (nodeSettings.storageConfig?.storageMode === 'filesystem') {
                 await this.handleFilesystemUpload(job, videosPath);
            } else if (nodeSettings.storageConfig?.storageMode === 's3provider' && nodeSettings.storageConfig.s3Config) {
                const s3Config = nodeSettings.storageConfig.s3Config;
                await this.handleS3Upload(job, s3Config, videosPath);
            }
        }
    }

    private async handleFilesystemUpload(job: VideoPublishJob, videosPath: string): Promise<void> {
        const paths: Array<{ fileName: string; filePath: string; contentType: string }> = [];
                 
        if (job.format === 'm3u8') {
            const manifestFilePath = path.join(videosPath, job.videoId, 'adaptive/m3u8/manifest-' + job.resolution + '.m3u8');
            const segmentsDirectoryPath = path.join(videosPath, job.videoId, 'adaptive/m3u8', job.resolution);

            paths.push({ fileName: 'manifest-' + job.resolution + '.m3u8', filePath: manifestFilePath, contentType: 'application/vnd.apple.mpegurl' });

            if (fs.existsSync(segmentsDirectoryPath)) {
                fs.readdirSync(segmentsDirectoryPath).forEach(fileName => {
                    const segmentFilePath = path.join(segmentsDirectoryPath, fileName);
                    if (!fs.statSync(segmentFilePath).isDirectory()) {
                        paths.push({ fileName: fileName, filePath: segmentFilePath, contentType: 'video/mp2t' });
                    }
                });
            }
        } else {
            const ext = job.format === 'ogv' ? 'ogg' : job.format;
            const fileName = `${job.resolution}.${job.format}`;
            const filePath = path.join(videosPath, job.videoId, 'progressive', job.format, fileName);
            paths.push({ fileName: fileName, filePath: filePath, contentType: `video/${ext}` });
        }

        await this.nodeApiService.uploadVideo(job.jwtToken, job.videoId, job.format, job.resolution, paths);

        // Clean up local files after upload if using filesystem mode? 
        // Legacy code deletes files after upload if storageMode is filesystem.
            for (const p of paths) {
            if (fs.existsSync(p.filePath)) {
                fs.unlinkSync(p.filePath);
            }
        }
    }

    private async handleS3Upload(job: VideoPublishJob, s3Config: S3ValidationConfig, videosPath: string): Promise<void> {
        const paths: Array<{ key: string; filePath: string; contentType: string }> = [];
        // S3 Logic
        if (job.format === 'm3u8') {
            const manifestFilePath = path.join(videosPath, job.videoId, 'adaptive/m3u8/manifest-' + job.resolution + '.m3u8');
            const segmentsDirectoryPath = path.join(videosPath, job.videoId, 'adaptive/m3u8', job.resolution);
            const manifestKey = `external/videos/${job.videoId}/adaptive/m3u8/static/manifests/manifest-${job.resolution}.m3u8`;
            
            paths.push({ key: manifestKey, filePath: manifestFilePath, contentType: 'application/vnd.apple.mpegurl' });

            if (fs.existsSync(segmentsDirectoryPath)) {
                fs.readdirSync(segmentsDirectoryPath).forEach(fileName => {
                    const segmentFilePath = path.join(segmentsDirectoryPath, fileName);
                        if (!fs.statSync(segmentFilePath).isDirectory()) {
                        const segmentKey = `external/videos/${job.videoId}/adaptive/m3u8/${job.resolution}/segments/${fileName}`;
                        paths.push({ key: segmentKey, filePath: segmentFilePath, contentType: 'video/mp2t' });
                    }
                });
            }
        } else {
            const ext = job.format === 'ogv' ? 'ogg' : job.format; 
            const key = `external/videos/${job.videoId}/progressive/${job.format}/${job.resolution}.${job.format}`;
            const filePath = path.join(videosPath, job.videoId, 'progressive', job.format, `${job.resolution}.${job.format}`);
            paths.push({ key: key, filePath: filePath, contentType: `video/${ext}` });
        }
        
        await this.s3Service.uploadFilesWithProgress(s3Config, paths, (percent) => {
            const uploadProgress = Math.floor(percent / 2) + 50;
            this.socketService.broadcastToUser(job.jwtToken, 'echo', { 
                eventName: 'video_status', 
                payload: { 
                    type: 'publishing', 
                    videoId: job.videoId,
                    format: job.format,
                    resolution: job.resolution,
                    progress: uploadProgress 
                }
            });
        });
    }

    private async finishVideoPublish(jwtToken: string, videoId: string): Promise<void> {
        const videosPath = this.settingsRepository.getVideosDirectoryPath();
        await this.deleteDirectoryRecursive(path.join(videosPath, videoId, 'adaptive'));
        await this.deleteDirectoryRecursive(path.join(videosPath, videoId, 'progressive'));

        await this.nodeApiService.setVideoPublished(jwtToken, videoId);
        
        this.socketService.broadcastToUser(jwtToken, 'echo', { 
            eventName: 'video_status', 
            payload: { type: 'published', videoId: videoId } 
        });
    }
    
    // Helper methods
    
    private generateFfmpegVideoArguments(videoId: string, resolution: string, format: string, sourceFilePath: string, destinationFilePath: string, sourceFileExtension: string, externalVideosBaseUrl: string): string[] {
        const clientSettings = this.settingsRepository.getClientSettings();
        let width: string;
        let height: string;

        switch (resolution) {
            case '2160p': width = '3840'; height = '2160'; break;
            case '1440p': width = '2560'; height = '1440'; break;
            case '720p': width = '1280'; height = '720'; break;
            case '480p': width = '854'; height = '480'; break;
            case '360p': width = '640'; height = '360'; break;
            case '240p': width = '426'; height = '240'; break;
            case '1080p':
            default:
                width = '1920'; height = '1080'; break;
        }

        let bitrate = '', gop = '', framerate = '', segmentLength = '';
        const encoderSettings = clientSettings.videoEncoderSettings as unknown as {
            hls: Record<string, string>;
            mp4: Record<string, string>;
            webm: Record<string, string>;
            ogv: Record<string, string>;
        };

        if (format === 'm3u8') {
            bitrate = String(encoderSettings.hls[resolution + '-bitrate']) + 'k';
            gop = String(encoderSettings.hls['gop']);
            framerate = String(encoderSettings.hls['framerate']);
            segmentLength = String(encoderSettings.hls['segmentLength']);
        } else if (format === 'mp4') {
            bitrate = String(encoderSettings.mp4[resolution + '-bitrate']) + 'k';
            gop = String(encoderSettings.mp4['gop']);
            framerate = String(encoderSettings.mp4['framerate']);
        } else if (format === 'webm') {
            bitrate = String(encoderSettings.webm[resolution + '-bitrate']) + 'k';
            gop = String(encoderSettings.webm['gop']);
            framerate = String(encoderSettings.webm['framerate']);
        } else if (format === 'ogv') {
            bitrate = String(encoderSettings.ogv[resolution + '-bitrate']) + 'k';
            gop = String(encoderSettings.ogv['gop']);
            framerate = String(encoderSettings.ogv['framerate']);
        }

        // Determine scale filter based on processing agent and format
        let scale: string;
        if (clientSettings.processingAgent?.processingAgentType === 'cpu' || format === 'webm' || format === 'ogv') {
            scale = 'scale';
        } else if (clientSettings.processingAgent?.processingAgentType === 'gpu' && (format === 'm3u8' || format === 'mp4')) {
            if (clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
                scale = 'scale_cuda';
            } else {
                // AMD and others use standard scale
                scale = 'scale';
            }
        } else {
            scale = 'scale';
        }

        // Build filter complex string
        let filterComplex = `${scale}='if(gt(ih,iw),-1,${width})':'if(gt(ih,iw),${height},-1)',`;
        if (clientSettings.processingAgent?.processingAgentType === 'cpu' || format === 'webm' || format === 'ogv') {
            filterComplex += 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
        } else if (clientSettings.processingAgent?.processingAgentType === 'gpu' && (format === 'm3u8' || format === 'mp4')) {
            if (clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
                filterComplex += 'hwdownload,format=nv12,crop=trunc(iw/2)*2:trunc(ih/2)*2,hwupload_cuda';
            } else {
                // AMD and others
                filterComplex += 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
            }
        }

        const hlsSegmentOutputPath = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts');

        let args: string[] = [];
        const agentType = clientSettings.processingAgent?.processingAgentType ?? 'cpu';
        const agentName = clientSettings.processingAgent?.processingAgentName ?? '';

        if (agentType === 'cpu') {
            // CPU encoding
            if (format === 'm3u8') {
                args = [
                    '-i', sourceFilePath,
                    '-c:a', 'aac',
                    '-c:v', 'libx264', '-b:v', bitrate,
                    '-sc_threshold', '0',
                    '-vf', filterComplex,
                    '-g', gop, '-r', framerate,
                    '-f', 'hls',
                    '-hls_time', segmentLength,
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'vod',
                    destinationFilePath
                ];
            } else if (format === 'mp4') {
                args = [
                    '-i', sourceFilePath,
                    '-c:a', 'aac',
                    '-c:v', 'libx264', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-g', gop, '-r', framerate,
                    '-movflags', 'faststart',
                    '-y', destinationFilePath
                ];
            } else if (format === 'webm') {
                args = [
                    '-i', sourceFilePath,
                    '-c:a', 'libopus',
                    '-c:v', 'libvpx-vp9', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-g', gop, '-r', framerate,
                    '-y', destinationFilePath
                ];
            } else if (format === 'ogv') {
                args = [
                    '-i', sourceFilePath,
                    '-c:a', 'libopus',
                    '-c:v', 'libvpx', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-g', gop, '-r', framerate,
                    '-y', destinationFilePath
                ];
            }
        } else if (agentType === 'gpu') {
            if (agentName === 'NVIDIA') {
                // NVIDIA GPU encoding
                if (format === 'm3u8') {
                    const [decoderParam1, decoderParam2] = sourceFileExtension === '.ts'
                        ? ['-c:v', 'h264_cuvid']
                        : ['-hwaccel_output_format', 'cuda'];

                    args = [
                        '-hwaccel', 'cuvid',
                        decoderParam1, decoderParam2,
                        '-i', sourceFilePath,
                        '-c:a', 'aac',
                        '-c:v', 'h264_nvenc', '-b:v', bitrate,
                        '-sc_threshold', '0',
                        '-g', gop, '-r', framerate,
                        '-vf', filterComplex,
                        '-f', 'hls',
                        '-hls_time', segmentLength,
                        '-hls_segment_filename', hlsSegmentOutputPath,
                        '-hls_base_url', `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                        '-hls_playlist_type', 'vod',
                        destinationFilePath
                    ];
                } else if (format === 'mp4') {
                    const [decoderParam1, decoderParam2] = sourceFileExtension === '.ts'
                        ? ['-c:v', 'h264_cuvid']
                        : ['-hwaccel_output_format', 'cuda'];

                    args = [
                        '-hwaccel', 'cuvid',
                        decoderParam1, decoderParam2,
                        '-i', sourceFilePath,
                        '-c:a', 'aac',
                        '-c:v', 'h264_nvenc', '-b:v', bitrate,
                        '-vf', filterComplex,
                        '-g', gop, '-r', framerate,
                        '-movflags', 'faststart',
                        '-y', destinationFilePath
                    ];
                } else if (format === 'webm') {
                    // webm/ogv always use CPU codecs, even on NVIDIA GPU
                    args = [
                        '-i', sourceFilePath,
                        '-c:a', 'libopus',
                        '-c:v', 'libvpx-vp9', '-b:v', bitrate,
                        '-vf', filterComplex,
                        '-g', gop, '-r', framerate,
                        '-y', destinationFilePath
                    ];
                } else if (format === 'ogv') {
                    args = [
                        '-i', sourceFilePath,
                        '-c:a', 'libopus',
                        '-c:v', 'libvpx', '-b:v', bitrate,
                        '-vf', filterComplex,
                        '-g', gop, '-r', framerate,
                        '-y', destinationFilePath
                    ];
                }
            } else if (agentName === 'AMD') {
                // AMD GPU encoding
                if (format === 'm3u8') {
                    args = [
                        '-hwaccel', 'dxva2',
                        '-hwaccel_device', '0',
                        '-i', sourceFilePath,
                        '-c:a', 'aac',
                        '-c:v', 'h264_amf', '-b:v', bitrate,
                        '-sc_threshold', '0',
                        '-g', gop, '-r', framerate,
                        '-vf', filterComplex,
                        '-f', 'hls',
                        '-hls_time', segmentLength,
                        '-hls_segment_filename', hlsSegmentOutputPath,
                        '-hls_base_url', `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                        '-hls_playlist_type', 'vod',
                        destinationFilePath
                    ];
                } else if (format === 'mp4') {
                    args = [
                        '-hwaccel', 'dxva2',
                        '-hwaccel_device', '0',
                        '-i', sourceFilePath,
                        '-c:a', 'aac',
                        '-c:v', 'h264_amf', '-b:v', bitrate,
                        '-vf', filterComplex,
                        '-g', gop, '-r', framerate,
                        '-movflags', 'faststart',
                        '-y', destinationFilePath
                    ];
                } else if (format === 'webm') {
                    // webm/ogv always use CPU codecs, even on AMD GPU
                    args = [
                        '-i', sourceFilePath,
                        '-c:a', 'libopus',
                        '-c:v', 'libvpx-vp9', '-b:v', bitrate,
                        '-vf', filterComplex,
                        '-g', gop, '-r', framerate,
                        '-y', destinationFilePath
                    ];
                } else if (format === 'ogv') {
                    args = [
                        '-i', sourceFilePath,
                        '-c:a', 'libopus',
                        '-c:v', 'libvpx', '-b:v', bitrate,
                        '-vf', filterComplex,
                        '-g', gop, '-r', framerate,
                        '-y', destinationFilePath
                    ];
                }
            }
        }

        return args;
    }

    private timestampToSeconds(timestamp: string): number {
        const parts = timestamp.split(':');
        const hours = Number.parseInt(parts[0] ?? '0');
        const minutes = Number.parseInt(parts[1] ?? '0');
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
