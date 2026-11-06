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
        payload: { type?: string; resolution?: string; progress?: number };
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
        setVideoPublished: vi.fn().mockResolvedValue({ isError: false }),
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

  it('waits for canceled uploads to settle before declaring publishing drained', async () => {
    const internal = service as unknown as {
      performEncodingJob: () => Promise<void>;
      performUploadingJob: () => Promise<void>;
    };
    vi.spyOn(internal, 'performEncodingJob').mockResolvedValue(undefined);
    let finish!: () => void;
    const uploading = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const upload = vi.spyOn(internal, 'performUploadingJob').mockReturnValue(uploading);
    service.enqueuePendingPublishVideo(job());
    await vi.advanceTimersByTimeAsync(0);
    expect(upload).toHaveBeenCalledOnce();
    service.stoppingPublishVideoEncoding('video123');
    service.stopPendingPublishVideo('video123');
    let drained = false;
    const wait = service.waitForPublishingDrain('video123').then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await wait;
    expect(drained).toBe(true);
  });

  it('broadcasts zero immediately and repeatedly for new queued jobs, and stops on cancellation', async () => {
    const releases = [await encodingPool.acquire(), await encodingPool.acquire()];
    service.enqueuePendingPublishVideo(job());
    expect(broadcastToUser).toHaveBeenLastCalledWith('token', 'echo', {
      eventName: 'video_status',
      payload: {
        type: 'publishing',
        videoId: 'video123',
        format: 'mp4',
        resolution: '720p',
        progress: 0,
        stage: 'queued',
      },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(broadcastToUser).toHaveBeenCalledTimes(3);
    service.stoppingPublishVideoEncoding('video123');
    service.stopPendingPublishVideo('video123');
    await vi.advanceTimersByTimeAsync(4000);
    expect(broadcastToUser).toHaveBeenCalledTimes(3);
    expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
    releases.forEach((release) => {
      release();
    });
    await vi.advanceTimersByTimeAsync(0);
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
      expect(() => {
        service.enqueuePendingPublishVideo(job());
      }).toThrow('Publishing is still stopping');
      expect(() => {
        service.enqueuePendingPublishVideo(job('480p'));
      }).toThrow('Publishing is still stopping');
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
        { format: 'mp4', resolution: '480p', progress: 0, stage: 'queued' },
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
    const releases = [await encodingPool.acquire(), await encodingPool.acquire()];
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
      publishingJobs: [{ format: 'mp4', resolution: '720p', progress: 0, stage: 'queued' }],
    });
    service.close();
    releases.forEach((release) => {
      release();
    });
    await vi.advanceTimersByTimeAsync(0);
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

  it('sends published after the final progress update so the activity row stays published', async () => {
    const internal = service as unknown as {
      deleteDirectoryRecursive: (directory: string) => Promise<void>;
    };
    vi.spyOn(internal, 'deleteDirectoryRecursive').mockResolvedValue(undefined);
    service.enqueuePendingPublishVideo({ ...job(), uploadCompleted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
    const events = broadcastToUser.mock.calls.map((call) => call[2].payload);
    const complete = events.findIndex(
      (event) => event.type === 'publishing' && event.progress === 100
    );
    const published = events.findIndex((event) => event.type === 'published');
    expect(complete).toBeGreaterThanOrEqual(0);
    expect(published).toBeGreaterThan(complete);
    expect(events.at(-1)?.type).toBe('published');
  });

  it('keeps two encoders busy and admits the sixth job without advancing the clock', async () => {
    const internal = service as unknown as {
      performEncodingJob: (output: ReturnType<typeof job>) => Promise<void>;
      performUploadingJob: () => Promise<void>;
      finishVideoPublish: () => Promise<void>;
      inProgressPublishingJobs: unknown[];
      pendingPublishVideoQueue: unknown[];
    };
    const finishes = new Map<string, () => void>();
    const started: string[] = [];
    let active = 0,
      peak = 0;
    vi.spyOn(internal, 'performEncodingJob').mockImplementation(async (output) => {
      started.push(output.resolution);
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => finishes.set(output.resolution, resolve));
      active--;
    });
    vi.spyOn(internal, 'performUploadingJob').mockResolvedValue(undefined);
    vi.spyOn(internal, 'finishVideoPublish').mockResolvedValue(undefined);
    const initialTime = Date.now();
    for (let i = 0; i < 6; i++) {
      service.enqueuePendingPublishVideo(job(`${String(i)}p`));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['0p', '1p']);
    expect(internal.pendingPublishVideoQueue).toHaveLength(1);
    try {
      finishes.get('0p')?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual(['0p', '1p', '2p']);
      expect(internal.pendingPublishVideoQueue).toHaveLength(0);
      expect(internal.inProgressPublishingJobs).toHaveLength(5);
      for (let i = 1; i < 6; i++) {
        finishes.get(`${String(i)}p`)?.();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(started).toEqual(['0p', '1p', '2p', '3p', '4p', '5p']);
      expect(peak).toBe(2);
      expect(Date.now()).toBe(initialTime);
      expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
    } finally {
      service.close();
      finishes.forEach((finish) => {
        finish();
      });
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it('backs off only failed outputs, lets fresh work pass, and retains five-job admission', async () => {
    const internal = service as unknown as {
      nodeApiService: {
        setVideoFormatResolutionPublished: (
          token: string,
          video: string,
          format: string,
          resolution: string
        ) => Promise<unknown>;
      };
      finishVideoPublish: () => Promise<void>;
    };
    const attempts = new Map<string, number>();
    const confirm = vi
      .spyOn(internal.nodeApiService, 'setVideoFormatResolutionPublished')
      .mockImplementation((_token, _video, _format, resolution) => {
        const attempt = (attempts.get(resolution) ?? 0) + 1;
        attempts.set(resolution, attempt);
        if (resolution !== 'fresh' && attempt <= 2) {
          throw new Error('Node unavailable');
        }
        return Promise.resolve({ isError: false });
      });
    vi.spyOn(internal, 'finishVideoPublish').mockResolvedValue(undefined);
    for (let i = 0; i < 5; i++) {
      service.enqueuePendingPublishVideo({ ...job(String(i)), uploadCompleted: true });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(confirm).toHaveBeenCalledTimes(5);
    expect(
      service.getPublishingJobs('token', 'video123').every((output) => output.stage === 'retrying')
    ).toBe(true);
    service.enqueuePendingPublishVideo({ ...job('fresh'), uploadCompleted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts.get('fresh')).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(confirm).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(confirm).toHaveBeenCalledTimes(11);
    await vi.advanceTimersByTimeAsync(1999);
    expect(confirm).toHaveBeenCalledTimes(11);
    await vi.advanceTimersByTimeAsync(1);
    expect(confirm).toHaveBeenCalledTimes(16);
    expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
  });

  it.each(['stop', 'close'])('cancels delayed retries after %s', async (action) => {
    const internal = service as unknown as {
      nodeApiService: { setVideoFormatResolutionPublished: () => Promise<unknown> };
    };
    const confirm = vi
      .spyOn(internal.nodeApiService, 'setVideoFormatResolutionPublished')
      .mockRejectedValue(new Error('retry'));
    service.enqueuePendingPublishVideo({ ...job(), uploadCompleted: true });
    await vi.advanceTimersByTimeAsync(0);
    if (action === 'stop') {
      service.stoppingPublishVideoEncoding('video123');
      service.stopPendingPublishVideo('video123');
    } else {
      service.close();
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
  });

  it.each(['stop', 'close'])(
    'does not start an encoder when %s happens during Node admission',
    async (action) => {
      const internal = service as unknown as {
        nodeApiService: { setVideoPublishing: () => Promise<unknown> };
        performEncodingJob: () => Promise<void>;
      };
      let admit!: (value: unknown) => void;
      vi.spyOn(internal.nodeApiService, 'setVideoPublishing').mockReturnValue(
        new Promise((resolve) => {
          admit = resolve;
        })
      );
      const encode = vi.spyOn(internal, 'performEncodingJob');
      service.enqueuePendingPublishVideo(job());
      await vi.advanceTimersByTimeAsync(0);
      if (action === 'stop') {
        service.stoppingPublishVideoEncoding('video123');
        service.stopPendingPublishVideo('video123');
      } else {
        service.close();
      }
      admit({ isError: false });
      await vi.advanceTimersByTimeAsync(5000);
      expect(encode).not.toHaveBeenCalled();
      expect(service.getPublishingJobs('token', 'video123')).toEqual([]);
    }
  );
});
