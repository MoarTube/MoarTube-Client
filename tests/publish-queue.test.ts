import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VideoPublishService } from '../src/services/video-publish.js';
import { VideosController } from '../src/controllers/videos.js';
import { encodingPool } from '../src/utils/work-pool.js';

describe('publishing queue state', () => {
  let service: VideoPublishService;
  const broadcastToUser = vi.fn<
    (
      token: string,
      event: string,
      data: {
        eventName: string;
        payload: { resolution?: string; progress?: number };
      }
    ) => void
  >();
  const job = (
    resolution = '720p'
  ): Parameters<VideoPublishService['enqueuePendingPublishVideo']>[0] => ({
    jwtToken: 'token',
    videoId: 'video123',
    format: 'mp4' as const,
    resolution,
    sourceFileExtension: '.mp4',
  });

  beforeEach(() => {
    vi.useFakeTimers();
    broadcastToUser.mockClear();
    service = new VideoPublishService(
      { info: vi.fn(), error: vi.fn() } as never,
      {
        setVideoPublishing: vi.fn().mockResolvedValue({ isError: false }),
        setVideoFormatResolutionPublished: vi.fn().mockResolvedValue({ isError: false }),
      } as never,
      {} as never,
      { getVideosDirectoryPath: () => path.join(tmpdir(), randomUUID()) } as never,
      { broadcastToUser } as never,
      {} as never,
      {} as never
    );
  });

  afterEach(() => {
    service.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('broadcasts zero immediately and repeatedly for new queued jobs, and stops on cancellation', async () => {
    service.enqueuePendingPublishVideo(job());
    expect(broadcastToUser).toHaveBeenLastCalledWith('token', 'echo', {
      eventName: 'video_status',
      payload: {
        type: 'publishing',
        videoId: 'video123',
        format: 'mp4',
        resolution: '720p',
        progress: 0,
      },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(broadcastToUser).toHaveBeenCalledTimes(3);
    service.stoppingPublishVideoEncoding('video123');
    service.stopPendingPublishVideo('video123');
    await vi.advanceTimersByTimeAsync(4000);
    expect(broadcastToUser).toHaveBeenCalledTimes(3);
    expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
  });

  it('keeps both waiting stages at zero, rejects duplicates, and stops zero updates when encoding starts', async () => {
    const releases = [await encodingPool.acquire(), await encodingPool.acquire()];
    let finishEncoding!: () => void;
    const encoding = new Promise<void>((resolve) => {
      finishEncoding = resolve;
    });
    const internal = service as unknown as {
      performEncodingJob: () => Promise<void>;
      performUploadingJob: () => Promise<void>;
      finishVideoPublish: () => Promise<void>;
    };
    const encode = vi.spyOn(internal, 'performEncodingJob').mockReturnValue(encoding);
    vi.spyOn(internal, 'performUploadingJob').mockResolvedValue(undefined);
    vi.spyOn(internal, 'finishVideoPublish').mockResolvedValue(undefined);
    try {
      for (let i = 0; i < 6; i++) {
        service.enqueuePendingPublishVideo(job(`${String(i)}p`));
      }
      await vi.advanceTimersByTimeAsync(5000);
      expect(encode).not.toHaveBeenCalled();
      expect(service.getPublishingJobs('token', 'video123')).toHaveLength(6);
      for (let i = 0; i < 6; i++) {
        expect(
          broadcastToUser.mock.calls.some(
            (call) =>
              call[2].payload.resolution === `${String(i)}p` && call[2].payload.progress === 0
          )
        ).toBe(true);
        service.enqueuePendingPublishVideo(job(`${String(i)}p`));
      }
      expect(service.getPublishingJobs('token', 'video123')).toHaveLength(6);
      expect(service.getPublishingJobs('another-user', 'video123')).toEqual([]);
      releases[0]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(encode).toHaveBeenCalledTimes(1);
      broadcastToUser.mockClear();
      await vi.advanceTimersByTimeAsync(1000);
      expect(broadcastToUser.mock.calls.some((call) => call[2].payload.resolution === '0p')).toBe(
        false
      );
      expect(broadcastToUser.mock.calls.some((call) => call[2].payload.resolution === '5p')).toBe(
        true
      );
    } finally {
      service.close();
      releases.forEach((release) => {
        release();
      });
      finishEncoding();
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it('rejects republishing while cancelled jobs drain, then permits a fresh publication', async () => {
    const releases = [await encodingPool.acquire(), await encodingPool.acquire()];
    try {
      service.enqueuePendingPublishVideo(job());
      await vi.advanceTimersByTimeAsync(3000);
      service.stoppingPublishVideoEncoding('video123');
      service.stopPendingPublishVideo('video123');
      expect(() => { service.enqueuePendingPublishVideo(job()); }).toThrow(
        'Publishing is still stopping'
      );
      expect(() => { service.enqueuePendingPublishVideo(job('480p')); }).toThrow(
        'Publishing is still stopping'
      );
      expect(service.isPublishVideoEncodingStopping('video123')).toBe(true);
      releases.forEach((release) => {
        release();
      });
      await vi.advanceTimersByTimeAsync(0);

      const internal = service as unknown as {
        performEncodingJob: () => Promise<void>;
        performUploadingJob: () => Promise<void>;
        finishVideoPublish: () => Promise<void>;
      };
      const encode = vi.spyOn(internal, 'performEncodingJob').mockResolvedValue(undefined);
      vi.spyOn(internal, 'performUploadingJob').mockResolvedValue(undefined);
      vi.spyOn(internal, 'finishVideoPublish').mockResolvedValue(undefined);
      service.enqueuePendingPublishVideo(job('480p'));
      expect(service.getPublishingJobs('token', 'video123')).toEqual([
        { format: 'mp4', resolution: '480p', progress: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(encode).toHaveBeenCalledTimes(1);
      expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
      expect(
        broadcastToUser.mock.calls.some(
          (call) => call[2].payload.resolution === '480p' && call[2].payload.progress === 100
        )
      ).toBe(true);
    } finally {
      releases.forEach((release) => {
        release();
      });
    }
  });

  it('includes queued jobs in modal initialization without changing Node publication data', async () => {
    service.enqueuePendingPublishVideo(job());
    const publishes = [{ format: 'mp4', resolution: '720p', isPublished: false }];
    const controller = new VideosController(
      { getVideoPublishes: vi.fn().mockResolvedValue({ isError: false, publishes }) } as never,
      {} as never,
      service,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const reply = { send: vi.fn() };
    await controller.getVideoPublishes(
      { session: { jwtToken: 'token' }, params: { videoId: 'video123' } } as never,
      reply as never
    );
    expect(reply.send).toHaveBeenCalledWith({
      isError: false,
      publishes,
      publishingJobs: [{ format: 'mp4', resolution: '720p', progress: 0 }],
    });
  });

  it('keeps uploaded outputs below 100 until publication is confirmed', async () => {
    const internal = service as unknown as {
      performEncodingJob: () => Promise<void>;
      performUploadingJob: (output: ReturnType<typeof job>) => Promise<void>;
      handleFilesystemUpload: (output: ReturnType<typeof job>, directory: string) => Promise<void>;
      finishVideoPublish: () => Promise<void>;
      nodeApiService: {
        uploadVideo: (
          token: string,
          videoId: string,
          format: string,
          resolution: string,
          files: unknown[],
          progress: (percent: number) => void
        ) => Promise<void>;
        setVideoFormatResolutionPublished: () => Promise<{ isError: boolean }>;
      };
    };
    let confirm!: (response: { isError: boolean }) => void;
    vi.spyOn(internal.nodeApiService, 'setVideoFormatResolutionPublished').mockReturnValue(
      new Promise((resolve) => {
        confirm = resolve;
      })
    );
    Object.assign(internal.nodeApiService, {
      uploadVideo: vi.fn(
        (
          _token: string,
          _videoId: string,
          _format: string,
          _resolution: string,
          _files: unknown[],
          progress: (percent: number) => void
        ) => {
          progress(100);
          return Promise.resolve();
        }
      ),
    });
    vi.spyOn(internal, 'performEncodingJob').mockResolvedValue(undefined);
    vi.spyOn(internal, 'performUploadingJob').mockImplementation(async (output) => {
      await internal.handleFilesystemUpload(output, 'unused');
    });
    vi.spyOn(internal, 'finishVideoPublish').mockResolvedValue(undefined);
    service.enqueuePendingPublishVideo(job());
    await vi.advanceTimersByTimeAsync(3000);
    expect(service.getPublishingJobs('token', 'video123')[0]?.progress).toBe(99);
    expect(broadcastToUser.mock.calls.some((call) => call[2].payload.progress === 100)).toBe(false);
    confirm({ isError: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(broadcastToUser.mock.calls.some((call) => call[2].payload.progress === 100)).toBe(true);
    expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
  });
});
