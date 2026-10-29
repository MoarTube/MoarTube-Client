import type { ChildProcess } from 'node:child_process';
import { spawnMediaProcess as spawn } from '@/utils/media-processes.js';
import { getGpuProcessEnvironment } from '@/utils/hardware.js';
import {
  applyGpuDeviceArguments,
  getHardwareH264Options,
  getCudaScaleFilter,
} from '@/utils/gpu-encoding.js';
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
import type { FfmpegService } from './ffmpeg.js';
import axios from 'axios';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readLiveHls, withLiveHlsFiles, type LiveHlsSegment } from '@/utils/live-hls.js';
import { PlaylistArchive } from '@/utils/playlist-archive.js';
import { WorkPool } from '@/utils/work-pool.js';

const livePool = new WorkPool(2, 0);

interface StreamContext {
  archive?: PlaylistArchive;
  segmentCounter: number;
  nextExpectedSegmentIndex: number;
  endOfValidManifestPattern: Buffer;
  endOfValidManifestPatternLength: number;
}

interface SendSegmentOptions {
  manifestFilePath?: string;
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

interface HandleStreamDataOptions extends LiveHlsSegment {
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
  private readonly activeStreams: Map<
    string,
    {
      process?: ChildProcess;
      stopping: boolean;
      finished?: Promise<void>;
      aborter: AbortController;
    }
  > = new Map();
  private uploadingImages = { thumbnail: false, preview: false, poster: false };
  private lastVideoImagesUpdateTimestamp = 0;
  private closing = false;

  constructor(
    private readonly logger: Logger,
    private readonly nodeApiService: NodeApiService,
    private readonly s3Service: S3Service,
    private readonly settingsRepository: SettingsRepository,
    private readonly socketService: SocketService,
    private readonly manifestService: ManifestService,
    private readonly ffmpegService: FfmpegService
  ) {}

  public addProcessToLiveStreamTracker(videoId: string, process: ChildProcess): void {
    this.activeStreams.set(videoId, { process, stopping: false, aborter: new AbortController() });
  }

  public close(): void {
    this.closing = true;
    for (const stream of this.activeStreams.values()) {
      stream.stopping = true;
      stream.aborter.abort();
      stream.process?.kill();
    }
  }

  public isLiveStreamStopping(videoId: string): boolean {
    return this.activeStreams.get(videoId)?.stopping ?? false;
  }

  public liveStreamExists(videoId: string): boolean {
    return this.activeStreams.has(videoId);
  }

  public async stopLiveStream(videoId: string): Promise<void> {
    if (this.activeStreams.has(videoId)) {
      const stream = this.activeStreams.get(videoId);
      if (!stream) {
        return;
      }
      stream.stopping = true;
      stream.aborter.abort();
      if (stream.process) {
        stream.process.kill();
      }
      await stream.finished;
    }
  }

  public async performStreamingJob(
    jwtToken: string,
    videoId: string,
    rtmpUrl: string,
    format: string,
    resolution: string,
    isRecordingStreamRemotely: boolean,
    isRecordingStreamLocally: boolean
  ): Promise<void> {
    if (this.closing) {
      throw new Error('MoarTube Client is shutting down');
    }
    const release = livePool.tryAcquire();
    if (!release) {
      throw new Error('Live stream capacity reached');
    }
    try {
      this.logger.info(`[LiveStreamService] Starting live stream for id: ${videoId}`);
      if (this.activeStreams.size >= 2) {
        throw new Error('Live stream capacity reached');
      }

      const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
      const storageConfig = nodeSettings.storageConfig;

      if (storageConfig === undefined) {
        release();
        this.logger.error(
          `[LiveStreamService] No storage configuration found for video ${videoId}`
        );
        return;
      }

      const isCloudflareCdnEnabled = nodeSettings.isCloudflareCdnEnabled ?? false;
      const videosPath = this.settingsRepository.getVideosDirectoryPath();

      if (storageConfig.storageMode === 's3provider' && storageConfig.s3Config) {
        const prefix = `external/videos/${videoId}/adaptive/m3u8`;
        await this.s3Service.deleteDirectoryRecursive(storageConfig.s3Config, prefix);
      }

      await this.manifestService.refreshMasterManifest(jwtToken, videoId);

      const videoDir = path.join(videosPath, videoId);
      await this.deleteDirectoryRecursive(videoDir);

      ['source', 'images', 'adaptive'].forEach((dir) =>
        fs.mkdirSync(path.join(videoDir, dir), { recursive: true })
      );

      const sourceFilePath = path.join(videoDir, 'source', `${videoId}.ts`);
      const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(jwtToken);

      const encoderDirectory = path.join(videoDir, 'adaptive', 'encoder');
      fs.mkdirSync(encoderDirectory, { recursive: true });
      const livePlaylist = path.join(encoderDirectory, 'live.m3u8');
      const ffmpegArguments = withLiveHlsFiles(
        this.generateFfmpegLiveArguments(
          videoId,
          resolution,
          format,
          rtmpUrl,
          isRecordingStreamRemotely,
          externalVideosBaseUrl
        ),
        livePlaylist,
        resolution
      );

      const process = spawn(this.ffmpegService.getPath(), ffmpegArguments, {
        env: getGpuProcessEnvironment(this.settingsRepository.getClientSettings().processingAgent),
      });
      process.stdout.resume();
      this.addProcessToLiveStreamTracker(videoId, process);
      process.once('error', (error) => {
        release();
        this.logger.error({ err: error }, 'Live encoder failed');
      });

      let lengthSeconds = 0;
      let lengthTimestamp = '';
      let lengthUpdatePending = false;
      let stderrTail = '';

      const context: StreamContext = {
        ...(isRecordingStreamRemotely
          ? {
              archive: new PlaylistArchive(
                path.join(videoDir, 'adaptive', `archive-${resolution}.m3u8`)
              ),
            }
          : {}),
        segmentCounter: -1,
        nextExpectedSegmentIndex: 0,
        endOfValidManifestPattern: Buffer.from(`segment-${resolution}-0.ts\n`),
        endOfValidManifestPatternLength: 0,
      };
      context.endOfValidManifestPatternLength = context.endOfValidManifestPattern.length;

      process.stderr.on('data', (data: Buffer) => {
        stderrTail = (stderrTail + data.toString()).slice(-16 * 1024);
        if (!this.isLiveStreamStopping(videoId)) {
          const stderrTemp = Buffer.from(data).toString();
          if (stderrTemp.includes('time=') && !lengthUpdatePending) {
            const index = stderrTemp.indexOf('time=');
            const timePart = stderrTemp.substring(index + 5);
            lengthTimestamp = timePart.substring(0, 11);
            lengthSeconds = this.timestampToSeconds(lengthTimestamp);

            lengthUpdatePending = true;
            void this.nodeApiService
              .setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp)
              .catch(() => {})
              .finally(() => {
                lengthUpdatePending = false;
              });
          }
        }
      });

      const consumption = (async (): Promise<void> => {
        const activeStream = this.activeStreams.get(videoId);
        if (activeStream === undefined) {
          throw new Error('Live stream tracker is missing');
        }
        for await (const files of readLiveHls(livePlaylist, resolution, {
          finished: () => process.exitCode !== null || process.signalCode !== null,
          stopping: () => this.isLiveStreamStopping(videoId),
          signal: activeStream.aborter.signal,
        })) {
          if (this.isLiveStreamStopping(videoId)) {
            break;
          }
          await this.handleStreamData({
            ...files,
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
            sourceFilePath,
          });
        }
      })()
        .catch((error: unknown) => {
          if (!this.isLiveStreamStopping(videoId)) {
            this.logger.error({ err: error }, 'Live delivery failed');
          }
          process.kill();
        })
        .finally(async () => {
          try {
            await context.archive?.close();
          } finally {
            release();
          }
        });
      const active = this.activeStreams.get(videoId);
      if (active) {
        active.finished = consumption;
      }

      process.on('close', (code): void => {
        void (async (): Promise<void> => {
          await consumption;
          this.logger.info(`[LiveStreamService] Stream process exited with code ${String(code)}`);
          if (code !== 0 && !this.isLiveStreamStopping(videoId)) {
            this.logger.error(
              { videoId, code, stderr: stderrTail },
              'Live encoder exited unexpectedly'
            );
          }
          if (this.liveStreamExists(videoId)) {
            if (!this.isLiveStreamStopping(videoId)) {
              // Stopped externally (e.g. OBS stopped streaming)
              // Finalize cleanup similar to controller stopStream
              try {
                this.socketService.broadcastToUser(jwtToken, 'echo', {
                  eventName: 'video_status',
                  payload: { type: 'streaming_stopping', videoId: videoId },
                });

                const exitNodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
                const exitStorageConfig = exitNodeSettings.storageConfig;

                if (exitStorageConfig?.storageMode === 's3provider' && exitStorageConfig.s3Config) {
                  const s3Config = exitStorageConfig.s3Config;

                  const videoDataResponse = await this.nodeApiService.getVideoData(
                    jwtToken,
                    videoId
                  );
                  const videoData = videoDataResponse.videoData;
                  const isStreamRecordedRemotely = videoData.isStreamRecordedRemotely;

                  if (isStreamRecordedRemotely === true) {
                    const resolutions = videoData.outputs?.m3u8 ?? [];
                    await this.s3Service.convertM3u8DynamicManifestsToStatic(
                      s3Config,
                      videoId,
                      resolutions
                    );
                  } else {
                    const prefix = `external/videos/${videoId}/adaptive/m3u8`;
                    await this.s3Service.deleteDirectoryRecursive(s3Config, prefix);
                  }
                }

                const response = await this.nodeApiService.stopVideoStreaming(jwtToken, videoId);

                if (!response.isError) {
                  this.socketService.broadcastToUser(jwtToken, 'echo', {
                    eventName: 'video_status',
                    payload: { type: 'streaming_stopped', videoId: videoId },
                  });
                }
              } catch (exitError) {
                this.logger.error(
                  exitError instanceof Error ? exitError : new Error(String(exitError)),
                  'Error during stream exit cleanup'
                );
              }
            }
            this.activeStreams.delete(videoId);
          }
        })();
      });
    } catch (error) {
      release();
      throw error;
    }
  }

  private async handleStreamData(options: HandleStreamDataOptions): Promise<void> {
    const { context, manifestBuffer, segmentBuffer } = options;
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

  private async finalizeSegmentProcessing(
    manifestLines: string[],
    segmentBuffer: Buffer,
    options: HandleStreamDataOptions
  ): Promise<void> {
    const {
      context,
      resolution,
      jwtToken,
      videoId,
      storageConfig,
      isCloudflareCdnEnabled,
      externalVideosBaseUrl,
      isRecordingStreamLocally,
      isRecordingStreamRemotely,
      lengthTimestamp,
      format,
      sourceFilePath,
    } = options;

    let localCounter = context.segmentCounter;
    const segmentRegex = /(.*\/)(.*\.ts)$/;

    const updatedManifestLines = manifestLines.map((line) => {
      if (segmentRegex.test(line.trim())) {
        const match = segmentRegex.exec(line.trim());
        if (match) {
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
    const endOfValidManifestPatternIndex = newManifestBuffer.indexOf(
      context.endOfValidManifestPattern
    );

    if (
      endOfValidManifestPatternIndex !== -1 &&
      newManifestBuffer.length - context.endOfValidManifestPatternLength ===
        endOfValidManifestPatternIndex
    ) {
      context.nextExpectedSegmentIndex = localCounter;
      context.endOfValidManifestPattern = Buffer.from(
        `segment-${resolution}-${String(context.nextExpectedSegmentIndex)}.ts\n`
      );
      context.endOfValidManifestPatternLength = context.endOfValidManifestPattern.length;

      const currentSegmentCounter = localCounter - 1;
      const segmentFileName = `segment-${resolution}-${String(currentSegmentCounter)}.ts`;
      const manifestFileName = `manifest-${resolution}.m3u8`;

      if (context.archive) {
        let entryIndex = -1;
        for (let i = updatedManifestLines.length - 1; i >= 0; i--) {
          if (updatedManifestLines[i]?.trim().endsWith(segmentFileName)) {
            entryIndex = i;
            break;
          }
        }
        const duration = Number(
          updatedManifestLines[entryIndex - 1]?.match(/^#EXTINF:([\d.]+)/)?.[1]
        );
        if (entryIndex < 1 || !Number.isFinite(duration)) {
          throw new Error('Invalid recording manifest');
        }
        await context.archive.append(duration, String(updatedManifestLines[entryIndex]).trim());
      }

      await this.sendSegmentToNode({
        ...(context.archive ? { manifestFilePath: context.archive.file } : {}),
        jwtToken,
        videoId,
        resolution,
        manifestBuffer: newManifestBuffer,
        segmentBuffer,
        manifestFileName,
        segmentFileName,
        storageConfig,
        isCloudflareCdnEnabled,
        externalVideosBaseUrl,
      });
      this.sendImagesToNode(jwtToken, videoId, segmentBuffer, storageConfig);

      if (isRecordingStreamLocally) {
        fs.appendFileSync(sourceFilePath, segmentBuffer);
      }

      if (!isRecordingStreamRemotely) {
        const segmentIndexToRemove = currentSegmentCounter - 20;
        if (segmentIndexToRemove >= 0) {
          const segmentName = `segment-${resolution}-${String(segmentIndexToRemove)}.ts`;
          if (storageConfig.storageMode === 'filesystem') {
            void this.nodeApiService
              .removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName)
              .catch(() => {});
          } else if (storageConfig.s3Config !== undefined) {
            const segmentKey = `external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/${segmentName}`;
            void this.s3Service
              .deleteObjectWithKey(storageConfig.s3Config, segmentKey)
              .catch(() => {});
          }
        }
      }

      await this.nodeApiService.getVideoBandwidth(jwtToken, videoId).then((res) => {
        if (!res.isError) {
          this.socketService.broadcastToUser(jwtToken, 'echo', {
            eventName: 'video_status',
            payload: {
              type: 'streaming',
              videoId: videoId,
              lengthTimestamp: lengthTimestamp,
              bandwidth: res.bandwidth,
            },
          });
        }
      });
    }
  }

  private async sendSegmentToNode(options: SendSegmentOptions): Promise<void> {
    const {
      jwtToken,
      videoId,
      resolution,
      manifestBuffer,
      segmentBuffer,
      manifestFileName,
      segmentFileName,
      storageConfig,
      isCloudflareCdnEnabled,
      externalVideosBaseUrl,
      manifestFilePath,
    } = options;

    let processedManifestBuffer = manifestBuffer;
    const signal = this.activeStreams.get(videoId)?.aborter.signal;

    if (isCloudflareCdnEnabled) {
      const lines = processedManifestBuffer.toString().split(/\r?\n/);
      if (lines.length >= 10) {
        lines.splice(-3, 3);
        processedManifestBuffer = Buffer.from(lines.join('\n'));
      }
    }

    if (storageConfig.storageMode === 'filesystem') {
      const manifest = manifestFilePath
        ? fs.createReadStream(manifestFilePath)
        : processedManifestBuffer;
      try {
        await this.nodeApiService.uploadStream(jwtToken, {
          ...(signal ? { signal } : {}),
          videoId,
          format: 'm3u8',
          resolution,
          manifestBuffer: manifest,
          segmentBuffer,
          manifestFileName,
          segmentFileName,
        });
      } finally {
        if (manifestFilePath) {
          (manifest as fs.ReadStream).destroy();
        }
      }
    } else if (storageConfig.s3Config !== undefined) {
      const segmentKey = `external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/${segmentFileName}`;
      const manifestKey = `external/videos/${videoId}/adaptive/m3u8/dynamic/manifests/manifest-${resolution}.m3u8`;

      await this.s3Service.putObjectFromData(
        storageConfig.s3Config,
        segmentKey,
        segmentBuffer,
        'video/mp2t',
        signal
      );
      const manifest = manifestFilePath
        ? fs.createReadStream(manifestFilePath)
        : processedManifestBuffer;
      try {
        await this.s3Service.putObjectFromData(
          storageConfig.s3Config,
          manifestKey,
          manifest,
          'application/vnd.apple.mpegurl',
          signal
        );
      } finally {
        if (manifestFilePath) {
          (manifest as fs.ReadStream).destroy();
        }
      }
    }

    if (isCloudflareCdnEnabled) {
      const segmentUrl = `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/${segmentFileName}`;
      try {
        const response = await axios.get(segmentUrl, {
          responseType: 'stream',
          timeout: 5000,
          maxRedirects: 0,
          signal: AbortSignal.timeout(10_000),
        });
        let bytes = 0;
        await pipeline(
          response.data,
          new Writable({
            write(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              callback(
                bytes > 64 * 1024 ** 2 ? new Error('Cache response exceeds byte limit') : null
              );
            },
          })
        );
      } catch {
        /* Warming is optional; delivery has already completed. */
      }
    }
  }

  private sendImagesToNode(
    jwtToken: string,
    videoId: string,
    segmentBuffer: Buffer,
    storageConfig: StorageConfig
  ): void {
    if (
      !this.uploadingImages.thumbnail &&
      !this.uploadingImages.preview &&
      !this.uploadingImages.poster &&
      Date.now() - this.lastVideoImagesUpdateTimestamp > 10000
    ) {
      this.lastVideoImagesUpdateTimestamp = Date.now();
      const imagesDir = path.join(
        this.settingsRepository.getVideosDirectoryPath(),
        videoId,
        'images'
      );
      const sourceImagePath = path.join(imagesDir, 'source.jpg');
      this.uploadingImages = { thumbnail: true, preview: true, poster: true };

      const process = spawn(this.ffmpegService.getPath(), [
        '-i',
        'pipe:0',
        '-ss',
        '0.5',
        '-q',
        '18',
        '-frames:v',
        '1',
        '-y',
        sourceImagePath,
      ]);
      process.stderr.resume();
      const deadline = setTimeout(() => process.kill(), 30_000);
      deadline.unref();
      process.once('close', () => {
        clearTimeout(deadline);
      });
      process.once('error', () => {
        this.uploadingImages = { thumbnail: false, preview: false, poster: false };
      });

      // FFmpeg triggers a write EOF error when piping live mpeg-ts segments
      // because they lack trailer data. This is benign on Windows; swallow it
      // to prevent an unhandled 'error' event from crashing the process.
      process.stdin.on('error', () => {});

      process.stdin.write(segmentBuffer, () => {
        process.stdin.end();
      });

      process.on('exit', (code): void => {
        if (code !== 0) {
          this.uploadingImages = { thumbnail: false, preview: false, poster: false };
        }
        void (async (): Promise<void> => {
          if (code === 0 && fs.existsSync(sourceImagePath)) {
            try {
              this.uploadingImages = { thumbnail: true, preview: true, poster: true };
              const [thumbnail, preview, poster] = await Promise.all([
                sharp(sourceImagePath)
                  .resize({ width: 100 })
                  .resize(100, 100)
                  .jpeg({ quality: 90 })
                  .toBuffer(),
                sharp(sourceImagePath)
                  .resize({ width: 512 })
                  .resize(512, 288)
                  .jpeg({ quality: 90 })
                  .toBuffer(),
                sharp(sourceImagePath)
                  .resize({ width: 1280 })
                  .resize(1280, 720)
                  .jpeg({ quality: 90 })
                  .toBuffer(),
              ]);

              if (storageConfig.storageMode === 'filesystem') {
                // Node API methods: setThumbnail, setPreview, setPoster
                await this.nodeApiService.setThumbnail(jwtToken, videoId, thumbnail);
                await this.nodeApiService.setPreview(jwtToken, videoId, preview);
                await this.nodeApiService.setPoster(jwtToken, videoId, poster);
              } else if (storageConfig.s3Config !== undefined) {
                const s3Config = storageConfig.s3Config;
                await this.s3Service.putObjectFromData(
                  s3Config,
                  `external/videos/${videoId}/images/thumbnail.jpg`,
                  thumbnail,
                  'image/jpeg'
                );
                await this.s3Service.putObjectFromData(
                  s3Config,
                  `external/videos/${videoId}/images/preview.jpg`,
                  preview,
                  'image/jpeg'
                );
                await this.s3Service.putObjectFromData(
                  s3Config,
                  `external/videos/${videoId}/images/poster.jpg`,
                  poster,
                  'image/jpeg'
                );
              }
            } catch (err) {
              this.logger.error(err, `Failed to update images for live stream ${videoId}`);
            } finally {
              this.uploadingImages = { thumbnail: false, preview: false, poster: false };
            }
          }
        })();
      });
    }
  }

  private generateFfmpegLiveArguments(
    videoId: string,
    resolution: string,
    format: string,
    rtmpUrl: string,
    _isRecordingStreamRemotely: boolean,
    externalVideosBaseUrl: string
  ): string[] {
    const clientSettings = this.settingsRepository.getClientSettings();
    let bitrate = '',
      gop = '',
      framerate = '',
      segmentLength = '';

    if (format === 'm3u8' && clientSettings.liveEncoderSettings !== undefined) {
      const liveEncoderSettings = clientSettings.liveEncoderSettings as unknown as {
        hls?: Record<string, string | number>;
      };
      if (liveEncoderSettings.hls !== undefined) {
        bitrate = String(liveEncoderSettings.hls[`${resolution}-bitrate`] ?? '') + 'k';
        gop = String(liveEncoderSettings.hls['gop']);
        framerate = String(liveEncoderSettings.hls['framerate']);
        segmentLength = String(liveEncoderSettings.hls['segmentLength']);
      }
    }

    let args: string[] = [];

    const processingAgent = clientSettings.processingAgent ?? { processingAgentType: 'cpu' };

    const hardware = getHardwareH264Options(processingAgent, resolution);
    if (processingAgent.processingAgentType === 'cpu' || hardware !== undefined) {
      if (format === 'm3u8') {
        args = [
          '-listen',
          '1',
          '-timeout',
          '10000',
          '-f',
          'flv',
          '-i',
          rtmpUrl,
          '-c:v',
          hardware?.encoder ?? 'libx264',
          '-b:v',
          bitrate,
          '-sc_threshold',
          '0',
          '-g',
          gop,
          '-r',
          framerate,
          '-c:a',
          'aac',
          '-f',
          'hls',
          '-hls_time',
          segmentLength,
          '-hls_list_size',
          '20',
          '-hls_base_url',
          `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
          '-hls_playlist_type',
          'event',
          'pipe:1',
        ];
      }
    } else if (processingAgent.processingAgentType === 'gpu') {
      if (processingAgent.processingAgentName === 'NVIDIA') {
        if (format === 'm3u8') {
          args = [
            '-listen',
            '1',
            '-timeout',
            '10000',
            '-hwaccel',
            'cuvid',
            '-hwaccel_output_format',
            'cuda',
            '-f',
            'flv',
            '-i',
            rtmpUrl,
            '-c:v',
            'h264_nvenc',
            '-b:v',
            bitrate,
            '-sc_threshold',
            '0',
            '-g',
            gop,
            '-r',
            framerate,
            '-c:a',
            'aac',
            '-f',
            'hls',
            '-hls_time',
            segmentLength,
            '-hls_list_size',
            '20',
            '-hls_base_url',
            `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
            '-hls_playlist_type',
            'event',
            'pipe:1',
          ];
        }
      } else if (processingAgent.processingAgentName === 'AMD') {
        if (format === 'm3u8') {
          args = [
            '-listen',
            '1',
            '-timeout',
            '10000',
            '-hwaccel',
            'd3d11va',
            '-hwaccel_device',
            'selectedGpu',
            '-f',
            'flv',
            '-i',
            rtmpUrl,
            '-c:v',
            'h264_amf',
            '-b:v',
            bitrate,
            '-sc_threshold',
            '0',
            '-g',
            gop,
            '-r',
            framerate,
            '-c:a',
            'aac',
            '-f',
            'hls',
            '-hls_time',
            segmentLength,
            '-hls_list_size',
            '20',
            '-hls_base_url',
            `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
            '-hls_playlist_type',
            'event',
            'pipe:1',
          ];
        }
      }
    }

    {
      const hlsPlaylistTypeIdx = args.indexOf('-hls_playlist_type');
      if (hlsPlaylistTypeIdx !== -1) {
        args.splice(hlsPlaylistTypeIdx, 2);
      }
    }

    if (args.includes('h264_nvenc')) {
      args.splice(args.indexOf('-c:v'), 0, '-vf', getCudaScaleFilter(resolution));
    }
    if (hardware !== undefined && args.includes(hardware.encoder)) {
      args.splice(args.indexOf('-c:v'), 0, '-vf', hardware.filter);
      if (processingAgent.backend === 'videotoolbox') {
        args.splice(args.indexOf('-c:v'), 0, '-realtime', '1');
      }
    }
    return applyGpuDeviceArguments(args, clientSettings.processingAgent);
  }

  private timestampToSeconds(timestamp: string): number {
    const parts = timestamp.split(':');
    const hours = Number.parseInt(parts[0] ?? '0', 10);
    const minutes = Number.parseInt(parts[1] ?? '0', 10);
    const seconds = Number.parseFloat(parts[2] ?? '0');
    return hours * 3600 + minutes * 60 + seconds;
  }

  private async deleteDirectoryRecursive(directoryPath: string): Promise<void> {
    try {
      await fs.promises.rm(directoryPath, { recursive: true, force: true });
    } catch (error) {
      this.logger.error(error, `failed to delete directory path: ${directoryPath}`);
    }
  }
}
