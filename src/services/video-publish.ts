import { requireNodeSuccess } from '@/utils/node-actions.js';
import type { ChildProcess } from 'node:child_process';
import { spawnMediaProcess as spawn } from '@/utils/media-processes.js';
import { encodingPool } from '@/utils/work-pool.js';
import { getGpuProcessEnvironment } from '@/utils/hardware.js';
import {
  applyGpuDeviceArguments,
  getHardwareH264Options,
  getCudaScaleFilter,
} from '@/utils/gpu-encoding.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Logger } from 'pino';
import type { NodeApiService } from './node-api.js';
import type { S3Service, S3ValidationConfig } from './s3.js';
import type { SettingsRepository } from '../database/repositories/settings.js';
import type { SocketService } from './socket.js';
import type { ManifestService } from './manifest.js';
import type { FfmpegService } from './ffmpeg.js';

type PublishStage = 'queued' | 'encoding' | 'uploading' | 'finalizing' | 'retrying' | 'complete';

interface VideoPublishJob {
  jwtToken: string;
  videoId: string;
  format: 'm3u8' | 'mp4' | 'webm' | 'ogv';
  resolution: string;
  sourceFileExtension: string;
  idleInterval?: NodeJS.Timeout;
  progress?: number;
  stage?: PublishStage;
  stageStartedAt?: number;
  queuedAt?: number;
  retryCount?: number;
  nextAttemptAt?: number;
  uploadCompleted?: boolean;
  hasEncodingSlot?: boolean;
  encodingCompleted?: boolean;
  connection?: string;
}

interface EncodingJobState {
  aborter: AbortController;
  stopping: boolean;
  processes: Set<ChildProcess>;
  activeJobCount: number;
}

export class VideoPublishService {
  private inProgressPublishingJobCount = 0;
  private readonly maximumInProgressPublishingJobCount = 5;
  private activeEncoderCount = 0;
  private activeUploadCount = 0;
  private readonly inProgressPublishingJobs: VideoPublishJob[] = [];
  private readonly pendingPublishVideoQueue: VideoPublishJob[] = [];
  private readonly activeEncodingJobs: Map<string, EncodingJobState> = new Map();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private drainScheduled = false;
  private closing = false;
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly logger: Logger,
    private readonly nodeApiService: NodeApiService,
    private readonly s3Service: S3Service,
    private readonly settingsRepository: SettingsRepository,
    private readonly socketService: SocketService,
    manifestService: ManifestService,
    private readonly ffmpegService: FfmpegService
  ) {
    void manifestService;
    this.recoverUploads();
  }

  private connection(): string {
    const settings = this.settingsRepository.getClientSettings();
    return JSON.stringify([settings.nodeHttpProtocol, settings.nodeIp, settings.nodePort]);
  }

  private checkpointFile(job: VideoPublishJob): string {
    const id = createHash('sha256')
      .update(JSON.stringify([job.connection, job.videoId, job.format, job.resolution]))
      .digest('hex');
    return path.join(
      this.settingsRepository.getVideosDirectoryPath(),
      '.publish-recovery',
      id + '.json'
    );
  }

  private checkpoint(job: VideoPublishJob): void {
    // Bind durable recovery to the selected Node connection.
    if (job.connection === undefined) {
      return;
    }
    if (this.cancelled.has(job.videoId)) {
      if (!this.closing) {
        this.removeCheckpoint(job);
      }
      return;
    }
    const file = this.checkpointFile(job);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.part';
    const receipt = {
      jwtToken: job.jwtToken,
      videoId: job.videoId,
      format: job.format,
      resolution: job.resolution,
      sourceFileExtension: job.sourceFileExtension,
      encodingCompleted: job.encodingCompleted,
      uploadCompleted: job.uploadCompleted,
      connection: job.connection,
    };
    fs.writeFileSync(temporary, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  private removeCheckpoint(job: VideoPublishJob): void {
    if (job.connection !== undefined) {
      fs.rmSync(this.checkpointFile(job), { force: true });
    }
  }

  private recoverUploads(): void {
    try {
      const directory = path.join(
        this.settingsRepository.getVideosDirectoryPath(),
        '.publish-recovery'
      );
      if (!fs.existsSync(directory)) {
        return;
      }
      for (const name of fs.readdirSync(directory)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) {
          continue;
        }
        const job = JSON.parse(
          fs.readFileSync(path.join(directory, name), 'utf8')
        ) as VideoPublishJob;
        if (job.encodingCompleted === true) {
          this.enqueuePendingPublishVideo(job);
        }
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Publishing recovery receipts could not be loaded');
    }
  }

  public enqueuePendingPublishVideo(job: VideoPublishJob): void {
    // Do not reset cancellation while older jobs still share the stopped encoder state.
    if (
      this.activeEncodingJobs.get(job.videoId)?.stopping === true ||
      (this.cancelled.has(job.videoId) &&
        this.inProgressPublishingJobs.some((existing) => existing.videoId === job.videoId))
    ) {
      throw new Error('Publishing is still stopping; try again once it has stopped');
    }
    if (job.connection === undefined) {
      // Preserve in-memory operation for callers without a settings provider.
      if (typeof this.settingsRepository.getClientSettings === 'function') {
        job.connection = this.connection();
      }
    }
    if (job.uploadCompleted !== true) {
      this.cancelled.delete(job.videoId);
    }
    if (this.closing) {
      return;
    }
    if (
      [...this.pendingPublishVideoQueue, ...this.inProgressPublishingJobs].some(
        (existing) =>
          existing.videoId === job.videoId &&
          existing.format === job.format &&
          existing.resolution === job.resolution
      )
    ) {
      return;
    }
    if (this.pendingPublishVideoQueue.length >= 100 && (job.retryCount ?? 0) === 0) {
      throw new Error('Publishing queue is full');
    }
    this.pendingPublishVideoQueue.push(job);
    job.queuedAt ??= Date.now();
    this.setPublishStage(job, job.nextAttemptAt !== undefined ? 'retrying' : 'queued', 0);
    clearInterval(job.idleInterval);
    job.idleInterval = setInterval(() => {
      this.broadcastPublishProgress(job, job.progress ?? 0);
    }, 1000);
    this.logger.info(`[VideoPublishService] Enqueued job for video ${job.videoId}`);
    this.schedulePublishingJobs();
  }

  public getPublishingJobs(
    jwtToken: string,
    videoId: string
  ): {
    format: string;
    resolution: string;
    progress: number;
    stage: PublishStage;
  }[] {
    return [...this.pendingPublishVideoQueue, ...this.inProgressPublishingJobs]
      .filter(
        (job) =>
          job.jwtToken === jwtToken &&
          job.videoId === videoId &&
          !this.isPublishVideoEncodingStopping(videoId)
      )
      .map((job) => ({
        format: job.format,
        resolution: job.resolution,
        progress: job.progress ?? 0,
        stage: job.stage ?? 'queued',
      }));
  }

  private broadcastPublishProgress(job: VideoPublishJob, progress: number): void {
    if (this.closing || this.isPublishVideoEncodingStopping(job.videoId)) {
      return;
    }
    job.progress = progress;
    this.socketService.broadcastToUser(job.jwtToken, 'echo', {
      eventName: 'video_status',
      payload: {
        type: 'publishing',
        videoId: job.videoId,
        format: job.format,
        resolution: job.resolution,
        progress,
        stage: job.stage ?? 'queued',
      },
    });
  }

  private logPublishJob(
    job: VideoPublishJob,
    event: string,
    extra: Record<string, unknown> = {}
  ): void {
    this.logger.info(
      {
        videoId: job.videoId,
        format: job.format,
        resolution: job.resolution,
        stage: job.stage,
        attempt: (job.retryCount ?? 0) + 1,
        activePublishingJobs: this.inProgressPublishingJobCount,
        activeEncoders: this.activeEncoderCount,
        activeUploads: this.activeUploadCount,
        queuedJobs: this.pendingPublishVideoQueue.length,
        elapsedMs: Date.now() - (job.queuedAt ?? Date.now()),
        ...extra,
      },
      `[VideoPublishService] ${event}`
    );
  }

  private setPublishStage(job: VideoPublishJob, stage: PublishStage, progress: number): void {
    const now = Date.now();
    const previousStage = job.stage;
    const stageDurationMs = job.stageStartedAt === undefined ? 0 : now - job.stageStartedAt;
    job.stage = stage;
    job.stageStartedAt = now;
    this.logPublishJob(job, 'Stage changed', { previousStage, stageDurationMs });
    this.broadcastPublishProgress(job, progress);
  }

  public stopPendingPublishVideo(videoId: string): void {
    // Remove every pending job for this video, not just the first match - a
    // single "stop publishing" action is expected to cancel all queued
    // formats/resolutions for the video.
    let removedCount = 0;
    for (let i = this.pendingPublishVideoQueue.length - 1; i >= 0; i--) {
      const job = this.pendingPublishVideoQueue[i];
      if (job?.videoId === videoId) {
        this.removeCheckpoint(job);
        if (job.idleInterval) {
          clearInterval(job.idleInterval);
        }
        this.pendingPublishVideoQueue.splice(i, 1);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      this.logger.info(
        `[VideoPublishService] Removed ${String(removedCount)} pending job(s) for video ${videoId}`
      );
    }
    this.schedulePublishingJobs();
  }

  public isPublishVideoEncodingStopping(videoId: string): boolean {
    return this.cancelled.has(videoId) || (this.activeEncodingJobs.get(videoId)?.stopping ?? false);
  }

  public stoppingPublishVideoEncoding(videoId: string): void {
    this.cancelled.add(videoId);
    for (const job of [...this.pendingPublishVideoQueue, ...this.inProgressPublishingJobs]) {
      if (job.videoId === videoId) {
        clearInterval(job.idleInterval);
      }
      if (!this.closing && job.videoId === videoId) {
        this.removeCheckpoint(job);
      }
    }
    const state = this.activeEncodingJobs.get(videoId);
    if (state) {
      state.stopping = true;
      state.aborter.abort();
      for (const activeProcess of state.processes) {
        activeProcess.kill();
      }
      this.logger.info(`[VideoPublishService] Stopping encoding for video ${videoId}`);
    }
  }

  private schedulePublishingJobs(): void {
    if (this.closing || this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;
    // Coalesce a batch of enqueues before deciding which output is the last one.
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drainPublishingJobs();
    });
  }

  private drainPublishingJobs(): void {
    clearTimeout(this.retryTimer);
    if (this.closing) {
      return;
    }
    while (this.inProgressPublishingJobCount < this.maximumInProgressPublishingJobCount) {
      const index = this.pendingPublishVideoQueue.findIndex(
        (job) => (job.nextAttemptAt ?? 0) <= Date.now()
      );
      if (index === -1) {
        break;
      }
      const job = this.pendingPublishVideoQueue.splice(index, 1)[0];
      if (!job) {
        break;
      }
      delete job.nextAttemptAt;
      this.inProgressPublishingJobCount++;
      this.inProgressPublishingJobs.push(job);
      this.logPublishJob(job, 'Job admitted');
      void this.runPublishingJob(job);
    }
    const nextRetry = Math.min(
      ...this.pendingPublishVideoQueue.map((job) => job.nextAttemptAt ?? Infinity)
    );
    if (
      Number.isFinite(nextRetry) &&
      this.inProgressPublishingJobCount < this.maximumInProgressPublishingJobCount
    ) {
      this.retryTimer = setTimeout(
        () => {
          this.schedulePublishingJobs();
        },
        Math.max(0, nextRetry - Date.now())
      );
    }
  }

  private async runPublishingJob(job: VideoPublishJob): Promise<void> {
    let retry = false;
    try {
      await this.startPublishingJob(job);
      if (job.connection !== undefined && job.connection !== this.connection()) {
        throw new Error('Publication confirmation is waiting for its original Node connection');
      }
      if (this.isPublishVideoEncodingStopping(job.videoId)) {
        throw new Error('Publishing cancelled');
      }
      this.setPublishStage(job, 'finalizing', 99);
      const lastOutput =
        !this.pendingPublishVideoQueue.some((p) => p.videoId === job.videoId) &&
        !this.inProgressPublishingJobs.some((p) => p !== job && p.videoId === job.videoId);
      requireNodeSuccess(
        await this.nodeApiService.setVideoFormatResolutionPublished(
          job.jwtToken,
          job.videoId,
          job.format,
          job.resolution,
          lastOutput
        )
      );
      // The video-wide published event must follow the final per-output progress event.
      this.setPublishStage(job, 'complete', 100);
      const index = this.findInProgressPublishJobIndex(job);
      if (index !== -1) {
        this.inProgressPublishingJobs.splice(index, 1);
      }
      if (
        !this.pendingPublishVideoQueue.some((p) => p.videoId === job.videoId) &&
        !this.inProgressPublishingJobs.some((p) => p.videoId === job.videoId)
      ) {
        if (!lastOutput) {
          requireNodeSuccess(
            await this.nodeApiService.setVideoPublished(job.jwtToken, job.videoId)
          );
        }
        await this.finishVideoPublish(job.jwtToken, job.videoId);
      }
      this.removeCheckpoint(job);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check cancellation before releasing the last shared state entry.
      retry = !this.isPublishVideoEncodingStopping(job.videoId) && !this.closing;
      this.logger.error(
        {
          errMsg: errorMessage,
          videoId: job.videoId,
          format: job.format,
          resolution: job.resolution,
          stage: job.stage,
          attempt: (job.retryCount ?? 0) + 1,
        },
        '[VideoPublishService] Failed publishing job'
      );
      if (retry) {
        job.retryCount = (job.retryCount ?? 0) + 1;
        const retryDelayMs = Math.min(60_000, 1000 * 2 ** Math.min(job.retryCount - 1, 6));
        job.nextAttemptAt = Date.now() + retryDelayMs;
        this.logPublishJob(job, 'Retry scheduled', { retryDelayMs });
      }
    } finally {
      clearInterval(job.idleInterval);
      const index = this.findInProgressPublishJobIndex(job);
      if (index !== -1) {
        this.inProgressPublishingJobs.splice(index, 1);
      }
      if (job.hasEncodingSlot === true) {
        this.releaseEncodingJobSlot(job.videoId);
        job.hasEncodingSlot = false;
      }
      this.inProgressPublishingJobCount--;
      if (retry && !this.closing && !this.isPublishVideoEncodingStopping(job.videoId)) {
        this.enqueuePendingPublishVideo(job);
      }
      this.schedulePublishingJobs();
    }
  }

  public close(): void {
    this.closing = true;
    clearTimeout(this.retryTimer);
    for (const job of [...this.pendingPublishVideoQueue, ...this.inProgressPublishingJobs]) {
      clearInterval(job.idleInterval);
    }
    this.pendingPublishVideoQueue.length = 0;
    for (const id of this.activeEncodingJobs.keys()) {
      this.stoppingPublishVideoEncoding(id);
    }
  }

  private findInProgressPublishJobIndex(job: VideoPublishJob): number {
    return this.inProgressPublishingJobs.findIndex(
      (j) => j.videoId === job.videoId && j.format === job.format && j.resolution === job.resolution
    );
  }

  private releaseEncodingJobSlot(videoId: string): void {
    const state = this.activeEncodingJobs.get(videoId);
    if (state) {
      state.activeJobCount--;
      if (state.activeJobCount <= 0) {
        this.activeEncodingJobs.delete(videoId);
      }
    }
  }

  private assertPublishingActive(videoId: string): void {
    if (this.closing || this.isPublishVideoEncodingStopping(videoId)) {
      throw new Error('Publishing cancelled');
    }
  }

  private async startPublishingJob(job: VideoPublishJob): Promise<void> {
    this.assertPublishingActive(job.videoId);
    if (job.connection !== undefined && job.connection !== this.connection()) {
      throw new Error('Publishing recovery is waiting for its original Node connection');
    }
    if (job.uploadCompleted === true) {
      clearInterval(job.idleInterval);
      this.checkpoint(job);
      return;
    }

    const response = requireNodeSuccess(
      await this.nodeApiService.setVideoPublishing(job.jwtToken, job.videoId)
    ) as {
      isError: boolean;
    };
    if (!response.isError) {
      this.assertPublishingActive(job.videoId);
      // Share one state entry per videoId (get-or-create, never overwrite) since
      // multiple format/resolution jobs for the same video may be encoding at
      // once; reference-count so this job finishing doesn't delete tracking a
      // sibling job for the same video still needs. The slot is released by the
      // caller (runPublishingJob's finally handler) rather
      // than here, so the "stopping" flag on this entry is still observable to
      // the retry decision after a killed job rejects.
      let state = this.activeEncodingJobs.get(job.videoId);
      if (!state) {
        state = {
          stopping: false,
          processes: new Set(),
          activeJobCount: 0,
          aborter: new AbortController(),
        };
        this.activeEncodingJobs.set(job.videoId, state);
      }
      state.activeJobCount++;
      job.hasEncodingSlot = true;

      if (job.encodingCompleted !== true) {
        await encodingPool.run(() => {
          this.assertPublishingActive(job.videoId);
          clearInterval(job.idleInterval);
          this.setPublishStage(job, 'encoding', 0);
          return this.performEncodingJob(job);
        });
        job.encodingCompleted = true;
      }
      clearInterval(job.idleInterval);
      this.checkpoint(job);
      if (this.isPublishVideoEncodingStopping(job.videoId)) {
        throw new Error('Publishing cancelled');
      }
      this.activeUploadCount++;
      this.setPublishStage(job, 'uploading', 50);
      try {
        await this.performUploadingJob(job);
      } finally {
        this.activeUploadCount--;
        this.logPublishJob(job, 'Upload ended', {
          stageDurationMs: Date.now() - (job.stageStartedAt ?? Date.now()),
        });
      }
      if (this.isPublishVideoEncodingStopping(job.videoId)) {
        throw new Error('Publishing cancelled');
      }
      job.uploadCompleted = true;
      this.checkpoint(job);
    }
  }

  private async performEncodingJob(job: VideoPublishJob): Promise<void> {
    this.assertPublishingActive(job.videoId);

    const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(job.jwtToken);
    this.assertPublishingActive(job.videoId);
    const videosPath = this.settingsRepository.getVideosDirectoryPath();
    const sourceFilePath = path.join(
      videosPath,
      job.videoId,
      'source',
      job.videoId + job.sourceFileExtension
    );
    const destinationFilePath = this.prepareDestinationDirectory(videosPath, job);

    const ffmpegArguments = [
      '-progress',
      'pipe:1',
      '-stats_period',
      '0.1',
      '-nostats',
      ...this.generateFfmpegVideoArguments(
        job.videoId,
        job.resolution,
        job.format,
        sourceFilePath,
        destinationFilePath,
        job.sourceFileExtension,
        externalVideosBaseUrl
      ),
    ];

    return new Promise((resolve, reject) => {
      this.logger.info(
        `[VideoPublishService] Spawning ffmpeg: ${this.ffmpegService.getPath()} with args: ${ffmpegArguments.join(' ')}`
      );

      const process = spawn(this.ffmpegService.getPath(), ffmpegArguments, {
        env: getGpuProcessEnvironment(this.settingsRepository.getClientSettings().processingAgent),
      });
      const state = this.activeEncodingJobs.get(job.videoId);
      state?.processes.add(process);
      this.activeEncoderCount++;
      const encoderStartedAt = Date.now();
      this.logPublishJob(job, 'Encoder started');
      let tracked = true;

      const untrackProcess = (): void => {
        if (!tracked) {
          return;
        }
        tracked = false;
        state?.processes.delete(process);
        this.activeEncoderCount--;
        this.logPublishJob(job, 'Encoder ended', {
          encoderDurationMs: Date.now() - encoderStartedAt,
        });
      };

      process.on('error', (err) => {
        this.logger.error(
          err,
          `[VideoPublishService] Failed to spawn ffmpeg for job ${job.videoId}`
        );
        untrackProcess();
        reject(err);
      });

      this.monitorEncodingProcess(process, job, resolve, reject, untrackProcess);
    });
  }

  private prepareDestinationDirectory(videosPath: string, job: VideoPublishJob): string {
    const destinationFileExtension = '.' + job.format;
    const ensureDir = (p: string): void => {
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
      }
    };

    if (job.format === 'm3u8') {
      ensureDir(path.join(videosPath, job.videoId, 'adaptive', 'm3u8', job.resolution));
      return path.join(
        videosPath,
        job.videoId,
        'adaptive',
        'm3u8',
        'manifest-' + job.resolution + destinationFileExtension
      );
    }

    const subDir = job.format;
    ensureDir(path.join(videosPath, job.videoId, 'progressive', subDir));
    return path.join(
      videosPath,
      job.videoId,
      'progressive',
      subDir,
      job.resolution + destinationFileExtension
    );
  }

  private monitorEncodingProcess(
    process: ChildProcess,
    job: VideoPublishJob,
    resolve: () => void,
    reject: (err: Error) => void,
    untrackProcess: () => void
  ): void {
    let lengthSeconds = 0;
    let currentTimeSeconds = 0;
    let stderrOutput = '';
    const updateProgress = (): void => {
      if (lengthSeconds > 0 && currentTimeSeconds > 0) {
        const progress = Math.min(49, Math.ceil((currentTimeSeconds / lengthSeconds) * 50));
        if (progress > (job.progress ?? 0)) {
          this.broadcastPublishProgress(job, progress);
        }
      }
    };
    // readline retains incomplete records across arbitrary stdout chunks.
    if (process.stdout) {
      const progressLines = createInterface({ input: process.stdout });
      progressLines.on('line', (line) => {
        if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice('out_time_us='.length)) / 1_000_000;
          if (Number.isFinite(seconds) && seconds >= 0) {
            currentTimeSeconds = seconds;
            updateProgress();
          }
        }
      });
    }
    process.stderr?.on('data', (data) => {
      if (this.isPublishVideoEncodingStopping(job.videoId)) {
        process.kill();
        return;
      }
      stderrOutput = (stderrOutput + Buffer.from(data).toString()).slice(-64 * 1024);
      if (lengthSeconds === 0) {
        const duration = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)(?=,|\s)/.exec(stderrOutput);
        if (duration?.[1] !== undefined) {
          lengthSeconds = this.timestampToSeconds(duration[1]);
          updateProgress();
        }
      }
    });

    process.on('close', (code) => {
      untrackProcess();
      if (code === 0) {
        this.broadcastPublishProgress(job, 50);
        resolve();
      } else {
        reject(
          new Error(
            `encoding process ended with an error code: ${String(code)}. stderr: ${stderrOutput}`
          )
        );
      }
    });
  }

  private async performUploadingJob(job: VideoPublishJob): Promise<void> {
    if (!this.isPublishVideoEncodingStopping(job.videoId)) {
      const nodeSettings = await this.nodeApiService.getNodeSettings(job.jwtToken);
      const videosPath = this.settingsRepository.getVideosDirectoryPath();

      if (nodeSettings.storageConfig?.storageMode === 'filesystem') {
        await this.handleFilesystemUpload(job, videosPath);
      } else if (
        nodeSettings.storageConfig?.storageMode === 's3provider' &&
        nodeSettings.storageConfig.s3Config
      ) {
        const s3Config = nodeSettings.storageConfig.s3Config;
        await this.handleS3Upload(job, s3Config, videosPath);
      } else {
        throw new Error('Node storage configuration does not allow publishing');
      }
    }
  }

  private async handleFilesystemUpload(job: VideoPublishJob, videosPath: string): Promise<void> {
    const paths: Array<{ fileName: string; filePath: string; contentType: string }> = [];

    if (job.format === 'm3u8') {
      const manifestFilePath = path.join(
        videosPath,
        job.videoId,
        'adaptive/m3u8/manifest-' + job.resolution + '.m3u8'
      );
      const segmentsDirectoryPath = path.join(
        videosPath,
        job.videoId,
        'adaptive/m3u8',
        job.resolution
      );

      paths.push({
        fileName: 'manifest-' + job.resolution + '.m3u8',
        filePath: manifestFilePath,
        contentType: 'application/vnd.apple.mpegurl',
      });

      if (fs.existsSync(segmentsDirectoryPath)) {
        fs.readdirSync(segmentsDirectoryPath).forEach((fileName) => {
          const segmentFilePath = path.join(segmentsDirectoryPath, fileName);
          if (!fs.statSync(segmentFilePath).isDirectory()) {
            paths.push({
              fileName: fileName,
              filePath: segmentFilePath,
              contentType: 'video/mp2t',
            });
          }
        });
      }
    } else {
      const ext = job.format === 'ogv' ? 'ogg' : job.format;
      const fileName = `${job.resolution}.${job.format}`;
      const filePath = path.join(videosPath, job.videoId, 'progressive', job.format, fileName);
      paths.push({ fileName: fileName, filePath: filePath, contentType: `video/${ext}` });
    }

    await this.nodeApiService.uploadVideo(
      job.jwtToken,
      job.videoId,
      job.format,
      job.resolution,
      paths,
      (percent) => {
        const uploadProgress = Math.min(99, Math.floor(percent / 2) + 50);
        this.broadcastPublishProgress(job, uploadProgress);
      },
      this.activeEncodingJobs.get(job.videoId)?.aborter.signal
    );
  }

  private async handleS3Upload(
    job: VideoPublishJob,
    s3Config: S3ValidationConfig,
    videosPath: string
  ): Promise<void> {
    const paths: Array<{ key: string; filePath: string; contentType: string }> = [];
    // S3 Logic
    if (job.format === 'm3u8') {
      const manifestFilePath = path.join(
        videosPath,
        job.videoId,
        'adaptive/m3u8/manifest-' + job.resolution + '.m3u8'
      );
      const segmentsDirectoryPath = path.join(
        videosPath,
        job.videoId,
        'adaptive/m3u8',
        job.resolution
      );
      const manifestKey = `external/videos/${job.videoId}/adaptive/m3u8/static/manifests/manifest-${job.resolution}.m3u8`;

      paths.push({
        key: manifestKey,
        filePath: manifestFilePath,
        contentType: 'application/vnd.apple.mpegurl',
      });

      if (fs.existsSync(segmentsDirectoryPath)) {
        fs.readdirSync(segmentsDirectoryPath).forEach((fileName) => {
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
      const filePath = path.join(
        videosPath,
        job.videoId,
        'progressive',
        job.format,
        `${job.resolution}.${job.format}`
      );
      paths.push({ key: key, filePath: filePath, contentType: `video/${ext}` });
    }

    const mediaPath =
      job.format === 'm3u8'
        ? 'adaptive/m3u8/'
        : `progressive/${job.format}/${job.resolution}.${job.format}`;
    await this.nodeApiService.withVideoCacheInvalidation(
      job.jwtToken,
      job.videoId,
      [mediaPath],
      async () => {
        await this.s3Service.uploadFilesWithProgress(
          s3Config,
          paths,
          (percent) => {
            const uploadProgress = Math.min(99, Math.floor(percent / 2) + 50);
            this.broadcastPublishProgress(job, uploadProgress);
          },
          this.activeEncodingJobs.get(job.videoId)?.aborter.signal
        );
        job.uploadCompleted = true;
        this.checkpoint(job);
      }
    );
  }

  private async finishVideoPublish(jwtToken: string, videoId: string): Promise<void> {
    const videosPath = this.settingsRepository.getVideosDirectoryPath();
    await this.deleteDirectoryRecursive(path.join(videosPath, videoId, 'adaptive'));
    await this.deleteDirectoryRecursive(path.join(videosPath, videoId, 'progressive'));

    this.socketService.broadcastToUser(jwtToken, 'echo', {
      eventName: 'video_status',
      payload: { type: 'published', videoId: videoId },
    });
  }

  // Helper methods

  private generateFfmpegVideoArguments(
    videoId: string,
    resolution: string,
    format: string,
    sourceFilePath: string,
    destinationFilePath: string,
    sourceFileExtension: string,
    externalVideosBaseUrl: string
  ): string[] {
    const clientSettings = this.settingsRepository.getClientSettings();
    let width: string;
    let height: string;

    switch (resolution) {
      case '2160p':
        width = '3840';
        height = '2160';
        break;
      case '1440p':
        width = '2560';
        height = '1440';
        break;
      case '720p':
        width = '1280';
        height = '720';
        break;
      case '480p':
        width = '854';
        height = '480';
        break;
      case '360p':
        width = '640';
        height = '360';
        break;
      case '240p':
        width = '426';
        height = '240';
        break;
      case '1080p':
      default:
        width = '1920';
        height = '1080';
        break;
    }

    let bitrate = '',
      gop = '',
      framerate = '',
      segmentLength = '';
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

    // Software formats retain their existing scaling and cropping behavior.
    let filterComplex = `scale='if(gt(ih,iw),-1,${width})':'if(gt(ih,iw),${height},-1)',crop=trunc(iw/2)*2:trunc(ih/2)*2`;
    if (
      clientSettings.processingAgent?.processingAgentType === 'gpu' &&
      clientSettings.processingAgent.processingAgentName === 'NVIDIA' &&
      (format === 'm3u8' || format === 'mp4')
    ) {
      filterComplex = getCudaScaleFilter(resolution);
    }

    const hardware = getHardwareH264Options(clientSettings.processingAgent, resolution);
    if (hardware !== undefined && (format === 'm3u8' || format === 'mp4')) {
      filterComplex = hardware.filter;
    }

    const hlsSegmentOutputPath = path.join(
      this.settingsRepository.getVideosDirectoryPath(),
      videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts'
    );

    let args: string[] = [];
    const agentType = clientSettings.processingAgent?.processingAgentType ?? 'cpu';
    const agentName = clientSettings.processingAgent?.processingAgentName ?? '';

    if (agentType === 'cpu' || hardware !== undefined) {
      // These backends share output packaging and software-only formats.
      if (format === 'm3u8') {
        args = [
          '-i',
          sourceFilePath,
          '-c:a',
          'aac',
          '-c:v',
          hardware?.encoder ?? 'libx264',
          '-b:v',
          bitrate,
          '-sc_threshold',
          '0',
          '-vf',
          filterComplex,
          '-g',
          gop,
          '-r',
          framerate,
          '-f',
          'hls',
          '-hls_time',
          segmentLength,
          '-hls_segment_filename',
          hlsSegmentOutputPath,
          '-hls_base_url',
          `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
          '-hls_playlist_type',
          'vod',
          destinationFilePath,
        ];
      } else if (format === 'mp4') {
        args = [
          '-i',
          sourceFilePath,
          '-c:a',
          'aac',
          '-c:v',
          hardware?.encoder ?? 'libx264',
          '-b:v',
          bitrate,
          '-vf',
          filterComplex,
          '-g',
          gop,
          '-r',
          framerate,
          '-movflags',
          'faststart',
          '-y',
          destinationFilePath,
        ];
      } else if (format === 'webm') {
        args = [
          '-i',
          sourceFilePath,
          '-c:a',
          'libopus',
          '-c:v',
          'libvpx-vp9',
          '-b:v',
          bitrate,
          '-vf',
          filterComplex,
          '-g',
          gop,
          '-r',
          framerate,
          '-y',
          destinationFilePath,
        ];
      } else if (format === 'ogv') {
        args = [
          '-i',
          sourceFilePath,
          '-c:a',
          'libopus',
          '-c:v',
          'libvpx',
          '-b:v',
          bitrate,
          '-vf',
          filterComplex,
          '-g',
          gop,
          '-r',
          framerate,
          '-y',
          destinationFilePath,
        ];
      }
    } else if (agentType === 'gpu') {
      if (agentName === 'NVIDIA') {
        // NVIDIA GPU encoding
        if (format === 'm3u8') {
          // Always request CUDA hardware frames from the decoder so the scale_cuda
          // filter (built above) has a valid hw-frame input. For .ts sources (e.g.
          // recordings of live streams) also pin the explicit cuvid decoder, since
          // format auto-detection is less reliable for raw mpeg-ts.
          const decoderArgs =
            sourceFileExtension === '.ts'
              ? ['-hwaccel_output_format', 'cuda', '-c:v', 'h264_cuvid']
              : ['-hwaccel_output_format', 'cuda'];

          args = [
            '-hwaccel',
            'cuvid',
            ...decoderArgs,
            '-i',
            sourceFilePath,
            '-c:a',
            'aac',
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
            '-vf',
            filterComplex,
            '-f',
            'hls',
            '-hls_time',
            segmentLength,
            '-hls_segment_filename',
            hlsSegmentOutputPath,
            '-hls_base_url',
            `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
            '-hls_playlist_type',
            'vod',
            destinationFilePath,
          ];
        } else if (format === 'mp4') {
          // See the m3u8 branch above: -hwaccel_output_format cuda must always be
          // present for scale_cuda to receive valid hardware frames.
          const decoderArgs =
            sourceFileExtension === '.ts'
              ? ['-hwaccel_output_format', 'cuda', '-c:v', 'h264_cuvid']
              : ['-hwaccel_output_format', 'cuda'];

          args = [
            '-hwaccel',
            'cuvid',
            ...decoderArgs,
            '-i',
            sourceFilePath,
            '-c:a',
            'aac',
            '-c:v',
            'h264_nvenc',
            '-b:v',
            bitrate,
            '-vf',
            filterComplex,
            '-g',
            gop,
            '-r',
            framerate,
            '-movflags',
            'faststart',
            '-y',
            destinationFilePath,
          ];
        } else if (format === 'webm') {
          // webm/ogv always use CPU codecs, even on NVIDIA GPU
          args = [
            '-i',
            sourceFilePath,
            '-c:a',
            'libopus',
            '-c:v',
            'libvpx-vp9',
            '-b:v',
            bitrate,
            '-vf',
            filterComplex,
            '-g',
            gop,
            '-r',
            framerate,
            '-y',
            destinationFilePath,
          ];
        } else if (format === 'ogv') {
          args = [
            '-i',
            sourceFilePath,
            '-c:a',
            'libopus',
            '-c:v',
            'libvpx',
            '-b:v',
            bitrate,
            '-vf',
            filterComplex,
            '-g',
            gop,
            '-r',
            framerate,
            '-y',
            destinationFilePath,
          ];
        }
      } else if (agentName === 'AMD') {
        // AMD GPU encoding
        if (format === 'm3u8') {
          args = [
            '-hwaccel',
            'd3d11va',
            '-hwaccel_device',
            'selectedGpu',
            '-i',
            sourceFilePath,
            '-c:a',
            'aac',
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
            '-vf',
            filterComplex,
            '-f',
            'hls',
            '-hls_time',
            segmentLength,
            '-hls_segment_filename',
            hlsSegmentOutputPath,
            '-hls_base_url',
            `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
            '-hls_playlist_type',
            'vod',
            destinationFilePath,
          ];
        } else if (format === 'mp4') {
          args = [
            '-hwaccel',
            'd3d11va',
            '-hwaccel_device',
            'selectedGpu',
            '-i',
            sourceFilePath,
            '-c:a',
            'aac',
            '-c:v',
            'h264_amf',
            '-b:v',
            bitrate,
            '-vf',
            filterComplex,
            '-g',
            gop,
            '-r',
            framerate,
            '-movflags',
            'faststart',
            '-y',
            destinationFilePath,
          ];
        } else if (format === 'webm') {
          // webm/ogv always use CPU codecs, even on AMD GPU
          args = [
            '-i',
            sourceFilePath,
            '-c:a',
            'libopus',
            '-c:v',
            'libvpx-vp9',
            '-b:v',
            bitrate,
            '-vf',
            filterComplex,
            '-g',
            gop,
            '-r',
            framerate,
            '-y',
            destinationFilePath,
          ];
        } else if (format === 'ogv') {
          args = [
            '-i',
            sourceFilePath,
            '-c:a',
            'libopus',
            '-c:v',
            'libvpx',
            '-b:v',
            bitrate,
            '-vf',
            filterComplex,
            '-g',
            gop,
            '-r',
            framerate,
            '-y',
            destinationFilePath,
          ];
        }
      }
    }

    return applyGpuDeviceArguments(args, clientSettings.processingAgent);
  }

  private timestampToSeconds(timestamp: string): number {
    const parts = timestamp.split(':');
    const hours = Number.parseInt(parts[0] ?? '0');
    const minutes = Number.parseInt(parts[1] ?? '0');
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
