import { requireNodeSuccess } from '@/utils/node-actions.js';
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
import type { Logger } from '@/utils/logger.js';
import { LiveStreamImages } from './live-stream-images.js';
import type { NodeApiService } from './node-api.js';
import type { S3Service } from './s3.js';
import type { StorageConfig } from '@/types/node-api.js';
import type { SettingsRepository } from '../database/repositories/settings.js';
import type { SocketService } from './socket.js';
import type { ManifestService } from './manifest.js';
import type { FfmpegService } from './ffmpeg.js';
import { randomUUID } from 'node:crypto';
import { readLiveHls, withLiveHlsFiles, type LiveHlsSegment } from '@/utils/live-hls.js';
import { PlaylistArchive } from '@/utils/playlist-archive.js';
import { WorkPool } from '@/utils/work-pool.js';
import {
  readLiveStreamState,
  saveLiveStreamState,
  type LiveStreamState,
} from '@/utils/live-stream-state.js';

const livePool = new WorkPool(2, 0);

interface StreamContext {
  sessionStartIndex?: number;
  discontinuities?: number;
  cleanup?: Promise<void> | undefined;
  generation?: string;
  retained?: Map<string, { index: number; removedAt?: number; duration: number }>;
  longestWindow?: number;
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
}

interface HandleStreamDataOptions extends LiveHlsSegment {
  images?: LiveStreamImages;
  context: StreamContext;
  jwtToken: string;
  videoId: string;
  resolution: string;
  storageConfig: StorageConfig;
  isCloudflareCdnEnabled: boolean;
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
      drainSeconds?: () => number;
      aborter: AbortController;
    }
  > = new Map();
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

  public async stopLiveStream(videoId: string): Promise<number> {
    if (this.activeStreams.has(videoId)) {
      const stream = this.activeStreams.get(videoId);
      if (!stream) {
        return 0;
      }
      stream.stopping = true;
      stream.aborter.abort();
      if (stream.process) {
        stream.process.kill();
      }
      await stream.finished;
      return stream.drainSeconds?.() ?? 0;
    }
    return 0;
  }

  public async prepareStreamResume(
    jwtToken: string,
    videoId: string,
    resolution: string,
    isRecordingStreamRemotely: boolean,
    isRecordingStreamLocally: boolean
  ): Promise<LiveStreamState> {
    if (this.activeStreams.has(videoId)) {
      throw new Error('This stream is already active or stopping');
    }
    const response = requireNodeSuccess(await this.nodeApiService.getVideoData(jwtToken, videoId));
    const video = response.videoData;
    if (!video.isLive || video.isStreaming || video.isFinalized) {
      throw new Error('Only a stopped, unfinalized live stream can be resumed');
    }
    const meta = video.meta;
    if (
      meta?.resolution !== resolution ||
      meta.isRecordingStreamRemotely !== isRecordingStreamRemotely ||
      meta.isRecordingStreamLocally !== isRecordingStreamLocally
    ) {
      throw new Error(
        'Resume requires the original resolution and recording settings. Use Restart to change them.'
      );
    }
    const videoDir = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId);
    const state = readLiveStreamState(videoDir);
    if (!state) {
      throw new Error(
        'The saved stream state is unavailable on this Client. Use the original Client to resume.'
      );
    }
    if (
      state.resolution !== resolution ||
      state.isRecordingStreamRemotely !== isRecordingStreamRemotely ||
      state.isRecordingStreamLocally !== isRecordingStreamLocally
    ) {
      throw new Error('The saved stream settings do not match this video');
    }
    if (
      isRecordingStreamRemotely &&
      state.nextSegmentIndex > 0 &&
      !fs.existsSync(path.join(videoDir, 'adaptive', `archive-${resolution}.m3u8`))
    ) {
      throw new Error('The recorded playlist is unavailable on this Client');
    }
    state.lengthSeconds = Math.max(state.lengthSeconds, video.lengthSeconds ?? 0);
    return state;
  }

  public async performStreamingJob(
    jwtToken: string,
    videoId: string,
    rtmpUrl: string,
    format: string,
    resolution: string,
    isRecordingStreamRemotely: boolean,
    isRecordingStreamLocally: boolean,
    resumeState?: LiveStreamState
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
      if (this.activeStreams.has(videoId)) {
        throw new Error('This stream is already active or stopping');
      }
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

      if (!resumeState && storageConfig.storageMode === 's3provider' && storageConfig.s3Config) {
        const prefix = `external/videos/${videoId}/adaptive/m3u8`;
        await this.nodeApiService.withVideoCacheInvalidation(
          jwtToken,
          videoId,
          // Old segment URLs are no longer referenced after Restart. Only recorded
          // playlists reuse long-lived cache identities when this tree is replaced.
          ['master', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'].map(
            (name) => `adaptive/m3u8/static/manifests/manifest-${name}.m3u8`
          ),
          () =>
            this.s3Service.deleteDirectoryRecursive(
              storageConfig.s3Config as NonNullable<typeof storageConfig.s3Config>,
              prefix
            )
        );
      }

      await this.manifestService.refreshMasterManifest(jwtToken, videoId);

      const videoDir = path.join(videosPath, videoId);
      if (!resumeState) {
        await this.deleteDirectoryRecursive(videoDir);
      }

      ['source', 'images', 'adaptive'].forEach((dir) =>
        fs.mkdirSync(path.join(videoDir, dir), { recursive: true })
      );

      const sourceFilePath = path.join(videoDir, 'source', `${videoId}.ts`);

      const state: LiveStreamState = resumeState
        ? { ...resumeState }
        : {
            generation: randomUUID(),
            nextSegmentIndex: 0,
            lengthSeconds: 0,
            discontinuities: 0,
            resolution,
            isRecordingStreamRemotely,
            isRecordingStreamLocally,
          };
      const startNumber = state.nextSegmentIndex;
      const lengthOffset = state.lengthSeconds;
      const discontinuities = state.discontinuities + (resumeState && startNumber > 0 ? 1 : 0);
      saveLiveStreamState(videoDir, state);
      // Each encoder gets fresh working files; published segments and recordings stay intact.
      const encoderDirectory = path.join(videoDir, 'adaptive', 'encoder', randomUUID());
      fs.mkdirSync(encoderDirectory, { recursive: true });
      const livePlaylist = path.join(encoderDirectory, 'live.m3u8');
      const ffmpegArguments = withLiveHlsFiles(
        this.generateFfmpegLiveArguments(videoId, resolution, format, rtmpUrl),
        livePlaylist,
        resolution,
        startNumber
      );

      const process = spawn(this.ffmpegService.getPath(), ffmpegArguments, {
        env: getGpuProcessEnvironment(this.settingsRepository.getClientSettings().processingAgent),
      });
      process.stdout.resume();
      this.addProcessToLiveStreamTracker(videoId, process);
      process.once('error', (error) => {
        release();
        this.logger.error(`Live encoder failed for video ${videoId}`, error);
      });

      let lengthSeconds = lengthOffset;
      let lengthTimestamp = this.secondsToTimestamp(lengthOffset);
      let lengthUpdatePending = false;
      let stderrTail = '';
      let deliveryFailed = false;

      const context: StreamContext = {
        generation: state.generation,
        sessionStartIndex: startNumber,
        discontinuities,
        ...(isRecordingStreamRemotely
          ? {
              archive: new PlaylistArchive(
                path.join(videoDir, 'adaptive', `archive-${resolution}.m3u8`),
                0,
                Boolean(
                  resumeState &&
                  fs.existsSync(path.join(videoDir, 'adaptive', `archive-${resolution}.m3u8`))
                )
              ),
            }
          : {}),
        segmentCounter: -1,
        nextExpectedSegmentIndex: startNumber,
        endOfValidManifestPattern: Buffer.from(`segment-${resolution}-${String(startNumber)}.ts\n`),
        endOfValidManifestPatternLength: 0,
      };
      context.endOfValidManifestPatternLength = context.endOfValidManifestPattern.length;
      const tracker = this.activeStreams.get(videoId);
      if (tracker) {
        tracker.drainSeconds = () => Math.ceil((context.longestWindow ?? 0) * 2 + 6);
      }

      if (!tracker) {
        throw new Error('Live stream tracker is missing');
      }
      const images = new LiveStreamImages({
        jwtToken,
        videoId,
        signal: tracker.aborter.signal,
        storageConfig,
        ffmpegPath: this.ffmpegService.getPath(),
        logger: this.logger,
        nodeApiService: this.nodeApiService,
        s3Service: this.s3Service,
        socketService: this.socketService,
      });

      process.stderr.on('data', (data: Buffer) => {
        stderrTail = (stderrTail + data.toString()).slice(-16 * 1024);
        if (!this.isLiveStreamStopping(videoId)) {
          const stderrTemp = Buffer.from(data).toString();
          if (stderrTemp.includes('time=') && !lengthUpdatePending) {
            const index = stderrTemp.indexOf('time=');
            const timePart = stderrTemp.substring(index + 5);
            const elapsed = this.timestampToSeconds(timePart.substring(0, 11));
            if (!Number.isFinite(elapsed) || elapsed < 0) {
              return;
            }
            lengthSeconds = lengthOffset + elapsed;
            lengthTimestamp = this.secondsToTimestamp(lengthSeconds);
            state.lengthSeconds = lengthSeconds;

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
          startNumber,
        })) {
          if (this.isLiveStreamStopping(videoId)) {
            break;
          }
          await this.handleStreamData({
            ...files,
            images,
            context,
            jwtToken,
            videoId,
            resolution,
            storageConfig,
            isCloudflareCdnEnabled,
            isRecordingStreamLocally,
            isRecordingStreamRemotely,
            lengthTimestamp,
            format,
            sourceFilePath,
          });
          state.nextSegmentIndex = context.nextExpectedSegmentIndex;
          state.discontinuities = discontinuities;
          saveLiveStreamState(videoDir, state);
        }
      })()
        .catch((error: unknown) => {
          if (!this.isLiveStreamStopping(videoId)) {
            deliveryFailed = true;
            this.logger.error(
              `Live delivery failed for video ${videoId}; terminating encoder`,
              error
            );
          }
          process.kill();
        })
        .finally(async () => {
          try {
            await images.finish();
            await context.archive?.close();
            saveLiveStreamState(videoDir, state);
          } finally {
            release();
          }
        });
      const active = this.activeStreams.get(videoId);
      if (active) {
        active.finished = consumption;
      }

      process.on('close', (code, signal): void => {
        void (async (): Promise<void> => {
          await consumption;
          this.logger.info(
            `[LiveStreamService] Stream process for video ${videoId} exited with code ${String(code)}, signal ${String(signal)}${deliveryFailed ? ' after delivery failure' : ''}`
          );
          if (code !== 0 && !deliveryFailed && !this.isLiveStreamStopping(videoId)) {
            this.logger.error(`Live encoder exited unexpectedly for video ${videoId}`, {
              videoId,
              code,
              signal,
              stderr: stderrTail,
            });
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

                const response = await this.nodeApiService.stopVideoStreaming(
                  jwtToken,
                  videoId,
                  Math.ceil((context.longestWindow ?? 0) * 2 + 6)
                );

                if (!response.isError) {
                  this.socketService.broadcastToUser(jwtToken, 'echo', {
                    eventName: 'video_status',
                    payload: { type: 'streaming_stopped', videoId: videoId },
                  });
                }
              } catch (exitError) {
                this.logger.error(
                  `Error during stream exit cleanup for video ${videoId}`,
                  exitError instanceof Error ? exitError : new Error(String(exitError))
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

    // Compare encoder numbering before translating to immutable public names.
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
      const originalSegmentFileName = `segment-${resolution}-${String(currentSegmentCounter)}.ts`;
      const publicName = (index: number): string =>
        `segment-${resolution}-${context.generation ? context.generation + '-' : ''}${String(index)}.ts`;
      const segmentFileName = publicName(currentSegmentCounter);
      const publicLines = updatedManifestLines.map((line) =>
        line.replace(new RegExp(`segment-${resolution}-(\\d+)\\.ts$`), (_match, index: string) =>
          publicName(Number(index))
        )
      );
      const resumed = (context.discontinuities ?? 0) > 0;
      const boundary = context.sessionStartIndex ?? 0;
      if (resumed) {
        const beforeBoundary = context.segmentCounter <= boundary;
        publicLines.splice(
          2,
          0,
          `#EXT-X-DISCONTINUITY-SEQUENCE:${String((context.discontinuities ?? 0) - (beforeBoundary ? 1 : 0))}`
        );
        if (beforeBoundary) {
          const uri = publicLines.findIndex((line) => line.trim().endsWith(publicName(boundary)));
          if (uri > 0) {
            publicLines.splice(uri - 1, 0, '#EXT-X-DISCONTINUITY');
          }
        }
      }
      const manifestFileName = `manifest-${resolution}.m3u8`;

      if (context.archive) {
        let entryIndex = -1;
        for (let i = updatedManifestLines.length - 1; i >= 0; i--) {
          if (updatedManifestLines[i]?.trim().endsWith(originalSegmentFileName)) {
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
        const targetDuration = Number(
          manifestLines.find((line) => line.startsWith('#EXT-X-TARGETDURATION:'))?.split(':')[1] ??
            0
        );
        await context.archive.append(
          duration,
          `../../${resolution}/segments/${segmentFileName}`,
          targetDuration,
          resumed && currentSegmentCounter === boundary
        );
      }

      await this.sendSegmentToNode({
        ...(context.archive ? { manifestFilePath: context.archive.file } : {}),
        jwtToken,
        videoId,
        resolution,
        manifestBuffer: Buffer.from(publicLines.join('\n')),
        segmentBuffer,
        manifestFileName,
        segmentFileName,
        storageConfig,
        isCloudflareCdnEnabled,
      });
      options.images?.enqueue(segmentBuffer);

      if (isRecordingStreamLocally) {
        fs.appendFileSync(sourceFilePath, segmentBuffer);
      }

      if (!isRecordingStreamRemotely) {
        context.retained ??= new Map();
        const durations = manifestLines.flatMap((line) => {
          const match = /^#EXTINF:([\d.]+)/.exec(line);
          return match ? [Number(match[1])] : [];
        });
        const windowSeconds = durations.reduce((sum, duration) => sum + duration, 0);
        context.longestWindow = Math.max(context.longestWindow ?? 0, windowSeconds);
        const duration = durations.at(-1) ?? 0;
        context.retained.set(segmentFileName, { index: currentSegmentCounter, duration });
        const now = Date.now();
        const retainedSegments = context.retained;
        for (const retained of retainedSegments.values()) {
          if (retained.index < context.segmentCounter) {
            retained.removedAt ??= now;
          }
        }
        if (context.cleanup === undefined) {
          const cleanup = async (): Promise<void> => {
            for (const [segmentName, retained] of [...retainedSegments]) {
              if (
                retained.removedAt === undefined ||
                now - retained.removedAt <
                  ((context.longestWindow ?? 0) + retained.duration + 5) * 1000
              ) {
                continue;
              }
              try {
                if (storageConfig.storageMode === 'filesystem') {
                  const response = (await this.nodeApiService.removeAdaptiveStreamSegment(
                    jwtToken,
                    videoId,
                    format,
                    resolution,
                    segmentName
                  )) as { isError?: boolean };
                  if (response.isError === true) {
                    throw new Error('Segment cleanup rejected');
                  }
                } else if (storageConfig.s3Config) {
                  await this.nodeApiService.withVideoCacheInvalidation(
                    jwtToken,
                    videoId,
                    [`adaptive/m3u8/${resolution}/segments/${segmentName}`],
                    async () => {
                      await this.s3Service.deleteObjectWithKey(
                        storageConfig.s3Config as NonNullable<typeof storageConfig.s3Config>,
                        `external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/${segmentName}`
                      );
                    }
                  );
                }
                retainedSegments.delete(segmentName);
              } catch (error) {
                this.logger.error(`Live segment cleanup will retry for video ${videoId}`, error);
                break; // Retry next publication without spinning through a failed backlog.
              }
            }
          };
          context.cleanup = cleanup().finally(() => {
            context.cleanup = undefined;
          });
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
      manifestFilePath,
    } = options;

    const processedManifestBuffer = manifestBuffer;
    const signal = this.activeStreams.get(videoId)?.aborter.signal;

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

      await this.nodeApiService.withVideoCacheInvalidation(
        jwtToken,
        videoId,
        [`adaptive/m3u8/dynamic/manifests/manifest-${resolution}.m3u8`],
        async () => {
          await this.s3Service.putObjectFromData(
            storageConfig.s3Config as NonNullable<typeof storageConfig.s3Config>,
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
              storageConfig.s3Config as NonNullable<typeof storageConfig.s3Config>,
              manifestKey,
              manifest,
              'application/vnd.apple.mpegurl',
              signal,
              { liveSnapshot: processedManifestBuffer }
            );
          } finally {
            if (manifestFilePath) {
              (manifest as fs.ReadStream).destroy();
            }
          }
        }
      );
    }
  }

  private generateFfmpegLiveArguments(
    _videoId: string,
    resolution: string,
    format: string,
    rtmpUrl: string
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
          `../../${resolution}/segments/`,
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
            `../../${resolution}/segments/`,
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
            `../../${resolution}/segments/`,
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

  private secondsToTimestamp(seconds: number): string {
    const centiseconds = Math.round(seconds * 100);
    const hours = Math.floor(centiseconds / 360000);
    const minutes = Math.floor((centiseconds % 360000) / 6000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${((centiseconds % 6000) / 100).toFixed(2).padStart(5, '0')}`;
  }

  private async deleteDirectoryRecursive(directoryPath: string): Promise<void> {
    try {
      await fs.promises.rm(directoryPath, { recursive: true, force: true });
    } catch (error) {
      this.logger.error(`failed to delete directory path: ${directoryPath}`, error);
    }
  }
}
