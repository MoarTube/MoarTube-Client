import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { LiveStreamImages } from '../src/services/live-stream-images.js';
import { spawnMediaProcess } from '../src/utils/media-processes.js';
import { renderImages } from '../src/utils/images.js';
import type * as Images from '../src/utils/images.js';
import type { BaseNodeResponse } from '../src/types/node-api.js';
import type { SocketService } from '../src/services/socket.js';

vi.mock('../src/utils/media-processes.js', () => ({ spawnMediaProcess: vi.fn() }));
vi.mock('../src/utils/images.js', async (original) => ({
  ...(await original<typeof Images>()),
  renderImages: vi.fn(),
}));

const workers: LiveStreamImages[] = [];
const controllers: AbortController[] = [];
const releases: Array<() => void> = [];
const frames: Buffer[] = [];

function held<T>(value: T): Promise<T> {
  return new Promise((resolve) =>
    releases.push(() => {
      resolve(value);
    })
  );
}

function child(complete = true) {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => process.emit('close', null));
      return true;
    }),
  });
  const bytes: Buffer[] = [];
  process.stdin.on('data', (data: Buffer) => bytes.push(data));
  process.stdin.on('finish', () => {
    const frame = Buffer.concat(bytes);
    frames.push(frame);
    if (complete) {
      process.stdout.end(frame);
      queueMicrotask(() => process.emit('close', 0));
    }
  });
  return process;
}

function fixture(storageMode: 'filesystem' | 's3provider' = 'filesystem', videoId = 'video') {
  const controller = new AbortController();
  controllers.push(controller);
  type SetImage = (
    token: string,
    video: string,
    buffer: Buffer,
    signal?: AbortSignal
  ) => Promise<BaseNodeResponse>;
  const api = {
    setThumbnail: vi.fn<SetImage>().mockResolvedValue({ isError: false }),
    setPreview: vi.fn<SetImage>().mockResolvedValue({ isError: false }),
    setPoster: vi.fn<SetImage>().mockResolvedValue({ isError: false }),
    withVideoCacheInvalidation: vi.fn(
      async (_token: string, _video: string, _paths: string[], action: () => Promise<void>) =>
        action()
    ),
  };
  const s3 = { putObjectFromData: vi.fn().mockResolvedValue(undefined) };
  const socket = { broadcastToUser: vi.fn<SocketService['broadcastToUser']>() };
  const logger = { error: vi.fn() };
  const worker = new LiveStreamImages({
    jwtToken: 'token',
    videoId,
    signal: controller.signal,
    ffmpegPath: 'ffmpeg',
    storageConfig: { storageMode, s3Config: {} } as never,
    nodeApiService: api as never,
    s3Service: s3 as never,
    socketService: socket as never,
    logger: logger as never,
  });
  workers.push(worker);
  return { worker, api, s3, socket, logger, controller };
}

beforeEach(() => {
  frames.length = 0;
  vi.mocked(spawnMediaProcess).mockImplementation(() => child() as never);
  vi.mocked(renderImages).mockImplementation((input, outputs) =>
    Promise.resolve(outputs.map(() => Buffer.from(input as Buffer)))
  );
});

afterEach(async () => {
  releases.splice(0).forEach((release) => {
    release();
  });
  controllers.splice(0).forEach((controller) => {
    controller.abort();
  });
  await Promise.all(workers.splice(0).map((worker) => worker.finish()));
  vi.resetAllMocks();
});

describe('live images from completed segments', () => {
  it.each(['filesystem', 's3provider'] as const)(
    'publishes consecutive segments without a ten-second wait using %s',
    async (storage) => {
      const { worker, api, socket, s3 } = fixture(storage);
      worker.enqueue(Buffer.from('first'));
      await vi.waitFor(() => {
        expect(socket.broadcastToUser).toHaveBeenCalledTimes(2);
      });
      worker.enqueue(Buffer.from('second'));
      await worker.finish();
      expect(frames.map((bytes) => bytes.toString())).toEqual(['first', 'second']);
      expect(socket.broadcastToUser).toHaveBeenCalledTimes(4);
      const events = socket.broadcastToUser.mock.calls.map((call) => call[2]);
      expect(events[0]).toMatchObject({
        eventName: 'video_status',
        payload: { type: 'images_updated', videoId: 'video', images: ['thumbnail'] },
      });
      expect(events[1]).toMatchObject({ payload: { images: ['preview', 'poster'] } });
      if (storage === 'filesystem') {
        expect(api.setThumbnail).toHaveBeenCalledTimes(2);
        expect(api.setThumbnail.mock.calls.map((call) => call[2].toString())).toEqual([
          'first',
          'second',
        ]);
      } else {
        expect(s3.putObjectFromData).toHaveBeenCalledTimes(6);
        expect(api.withVideoCacheInvalidation.mock.calls.map((call) => call[2])).toEqual([
          ['images/thumbnail.jpg'],
          ['images/preview.jpg', 'images/poster.jpg'],
          ['images/thumbnail.jpg'],
          ['images/preview.jpg', 'images/poster.jpg'],
        ]);
      }
    }
  );

  it('announces the first thumbnail before slower preview and poster processing finishes', async () => {
    const { worker, socket, api } = fixture();
    vi.mocked(renderImages)
      .mockResolvedValueOnce([Buffer.from('thumb')])
      .mockReturnValueOnce(held([Buffer.from('preview'), Buffer.from('poster')]));
    worker.enqueue(Buffer.from('segment'));
    await vi.waitFor(() => {
      expect(socket.broadcastToUser).toHaveBeenCalledOnce();
    });
    expect(api.setThumbnail).toHaveBeenCalledOnce();
    expect(api.setPreview).not.toHaveBeenCalled();
    expect(api.setPoster).not.toHaveBeenCalled();
    releases.splice(0).forEach((release) => {
      release();
    });
    await worker.finish();
    expect(socket.broadcastToUser).toHaveBeenCalledTimes(2);
  });

  it('retains only the newest pending segment when image processing falls behind', async () => {
    const { worker } = fixture();
    vi.mocked(renderImages).mockReturnValueOnce(held([Buffer.from('thumb')]));
    worker.enqueue(Buffer.from('first'));
    await vi.waitFor(() => {
      expect(renderImages).toHaveBeenCalledOnce();
    });
    worker.enqueue(Buffer.from('second'));
    worker.enqueue(Buffer.from('third'));
    releases.splice(0).forEach((release) => {
      release();
    });
    await worker.finish();
    expect(frames.map((frame) => frame.toString())).toEqual(['first', 'third']);
  });

  it("does not let a slow stream suppress another stream's first image", async () => {
    const first = fixture('filesystem', 'first');
    const second = fixture('filesystem', 'second');
    vi.mocked(renderImages).mockReturnValueOnce(held([Buffer.from('thumb')]));
    first.worker.enqueue(Buffer.from('first'));
    await vi.waitFor(() => {
      expect(renderImages).toHaveBeenCalledOnce();
    });
    second.worker.enqueue(Buffer.from('second'));
    await second.worker.finish();
    expect(first.socket.broadcastToUser).not.toHaveBeenCalled();
    expect(second.socket.broadcastToUser).toHaveBeenCalledTimes(2);
  });

  it('does not announce S3 images until their upload and cache invalidation complete', async () => {
    const { worker, api, s3, socket } = fixture('s3provider');
    const ack = held(undefined);
    api.withVideoCacheInvalidation.mockImplementationOnce(
      async (_token, _video, _paths, action) => {
        await action();
        await ack;
      }
    );
    worker.enqueue(Buffer.from('segment'));
    await vi.waitFor(() => {
      expect(s3.putObjectFromData).toHaveBeenCalledOnce();
    });
    expect(socket.broadcastToUser).not.toHaveBeenCalled();
    releases.splice(0).forEach((release) => {
      release();
    });
    await worker.finish();
    expect(socket.broadcastToUser).toHaveBeenCalledTimes(2);
  });

  it('retries on the next segment after an image upload is rejected', async () => {
    const { worker, api, socket, logger } = fixture();
    api.setThumbnail.mockResolvedValueOnce({ isError: true, message: 'upload rejected' });
    worker.enqueue(Buffer.from('first'));
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledOnce();
    });
    expect(socket.broadcastToUser).not.toHaveBeenCalled();
    worker.enqueue(Buffer.from('second'));
    await worker.finish();
    expect(api.setThumbnail).toHaveBeenCalledTimes(2);
    expect(socket.broadcastToUser).toHaveBeenCalledTimes(2);
  });

  it('cancels extraction and drops pending images when the stream stops', async () => {
    const process = child(false);
    vi.mocked(spawnMediaProcess).mockReturnValueOnce(process as never);
    const { worker, controller, api, socket } = fixture();
    worker.enqueue(Buffer.from('first'));
    worker.enqueue(Buffer.from('second'));
    controller.abort();
    await worker.finish();
    expect(process.kill).toHaveBeenCalledOnce();
    expect(spawnMediaProcess).toHaveBeenCalledOnce();
    expect(api.setThumbnail).not.toHaveBeenCalled();
    expect(socket.broadcastToUser).not.toHaveBeenCalled();
  });

  it('cancels an in-flight upload without publishing stale readiness after resume', async () => {
    const first = fixture();
    first.api.setThumbnail.mockImplementationOnce(
      (_token, _video, _buffer, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('cancelled'));
            },
            { once: true }
          );
        })
    );
    first.worker.enqueue(Buffer.from('before-stop'));
    await vi.waitFor(() => {
      expect(first.api.setThumbnail).toHaveBeenCalledOnce();
    });
    first.worker.enqueue(Buffer.from('pending'));
    first.controller.abort();
    await first.worker.finish();
    expect(first.socket.broadcastToUser).not.toHaveBeenCalled();
    expect(first.api.setPreview).not.toHaveBeenCalled();
    const resumed = fixture();
    resumed.worker.enqueue(Buffer.from('after-resume'));
    await resumed.worker.finish();
    expect(resumed.socket.broadcastToUser).toHaveBeenCalledTimes(2);
  });
});
