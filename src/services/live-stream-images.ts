import { randomUUID } from 'node:crypto';
import { spawnMediaProcess } from '@/utils/media-processes.js';
import { renderImages, VIDEO_IMAGES } from '@/utils/images.js';
import type { Logger } from '@/utils/logger.js';
import type { StorageConfig } from '@/types/node-api.js';
import type { NodeApiService } from './node-api.js';
import type { S3Service } from './s3.js';
import type { SocketService } from './socket.js';

interface LiveStreamImageOptions {
  jwtToken: string;
  videoId: string;
  signal: AbortSignal;
  ffmpegPath: string;
  storageConfig: StorageConfig;
  logger: Logger;
  nodeApiService: NodeApiService;
  s3Service: S3Service;
  socketService: SocketService;
}

type ImageName = 'thumbnail' | 'preview' | 'poster';
type Image = readonly [ImageName, Buffer];

/** One image job per stream, plus the newest pending segment when uploads are slow. */
export class LiveStreamImages {
  private pending: Buffer | undefined;
  private task: Promise<void> | undefined;
  private running = false;
  private closed = false;

  constructor(private readonly options: LiveStreamImageOptions) {}

  public enqueue(segment: Buffer): void {
    if (this.closed || this.options.signal.aborted) {
      return;
    }
    this.pending = segment;
    if (!this.running) {
      this.running = true;
      this.task = this.run();
    }
  }

  public async finish(): Promise<void> {
    this.closed = true;
    await this.task;
  }

  private async run(): Promise<void> {
    try {
      while (this.pending !== undefined && !this.isStopped()) {
        const segment = this.pending;
        this.pending = undefined;
        try {
          await this.publish(segment);
        } catch (error) {
          if (!this.isStopped()) {
            this.options.logger.error(
              `Failed to update images for live stream ${this.options.videoId}`,
              error
            );
          }
        }
      }
    } finally {
      this.pending = undefined;
      this.running = false;
    }
  }

  private isStopped(): boolean {
    return this.options.signal.aborted;
  }

  private async publish(segment: Buffer): Promise<void> {
    const { ffmpegPath, signal } = this.options;
    const frame = await this.extractFrame(segment);
    const [thumbnail] = await renderImages(frame, VIDEO_IMAGES.slice(0, 1), ffmpegPath, signal);
    if (thumbnail === undefined) {
      throw new Error('Live image processing did not produce a thumbnail');
    }
    // Publish the small image immediately; preview/poster work must not delay its display.
    await this.upload([['thumbnail', thumbnail]]);
    const [preview, poster] = await renderImages(frame, VIDEO_IMAGES.slice(1), ffmpegPath, signal);
    if (preview === undefined || poster === undefined) {
      throw new Error('Live image processing did not produce the preview and poster');
    }
    await this.upload([
      ['preview', preview],
      ['poster', poster],
    ]);
  }

  private async upload(images: readonly Image[]): Promise<void> {
    const { signal, jwtToken, videoId, storageConfig, nodeApiService, s3Service } = this.options;
    signal.throwIfAborted();
    if (storageConfig.storageMode === 'filesystem') {
      for (const [name, buffer] of images) {
        const response =
          name === 'thumbnail'
            ? await nodeApiService.setThumbnail(jwtToken, videoId, buffer, signal)
            : name === 'preview'
              ? await nodeApiService.setPreview(jwtToken, videoId, buffer, signal)
              : await nodeApiService.setPoster(jwtToken, videoId, buffer, signal);
        if (response.isError) {
          throw new Error(response.message ?? `Unable to upload live ${name}`);
        }
      }
    } else if (storageConfig.s3Config !== undefined) {
      const s3Config = storageConfig.s3Config;
      await nodeApiService.withVideoCacheInvalidation(
        jwtToken,
        videoId,
        images.map(([name]) => `images/${name}.jpg`),
        async () => {
          for (const [name, buffer] of images) {
            await s3Service.putObjectFromData(
              s3Config,
              `external/videos/${videoId}/images/${name}.jpg`,
              buffer,
              'image/jpeg',
              signal
            );
          }
        }
      );
    } else {
      throw new Error('Missing live image storage configuration');
    }
    signal.throwIfAborted();
    this.options.socketService.broadcastToUser(jwtToken, 'echo', {
      eventName: 'video_status',
      payload: {
        type: 'images_updated',
        videoId,
        images: images.map(([name]) => name),
        version: randomUUID(),
      },
    });
  }

  private extractFrame(segment: Buffer): Promise<Buffer> {
    const { signal, ffmpegPath } = this.options;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const process = spawnMediaProcess(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-threads',
        '1',
        '-f',
        'mpegts',
        '-i',
        'pipe:0',
        '-frames:v',
        '1',
        '-threads',
        '1',
        '-q:v',
        '18',
        '-f',
        'image2pipe',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ]);
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(deadline);
        signal.removeEventListener('abort', abort);
        if (error !== undefined) {
          reject(error);
        } else {
          resolve(Buffer.concat(chunks, size));
        }
      };
      const abort = (): void => {
        process.kill();
        finish(new Error('Live image generation cancelled'));
      };
      const deadline = setTimeout(() => {
        process.kill();
        finish(new Error('Live image extraction timed out'));
      }, 30_000);
      deadline.unref();
      process.stderr.resume();
      process.stdout.on('data', (bytes: Buffer) => {
        if (settled) {
          return;
        }
        size += bytes.length;
        if (size > 20 * 1024 ** 2) {
          process.kill();
          finish(new Error('Live frame exceeds the image byte limit'));
          return;
        }
        chunks.push(bytes);
      });
      process.once('error', finish);
      process.once('close', (code) => {
        finish(code === 0 && size > 0 ? undefined : new Error('Unable to extract a live frame'));
      });
      // A one-frame decoder can close its input before consuming the complete segment.
      process.stdin.on('error', () => {});
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
      } else {
        process.stdin.end(segment);
      }
    });
  }
}
