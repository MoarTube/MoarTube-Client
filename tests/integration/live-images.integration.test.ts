import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { LiveStreamImages } from '../../src/services/live-stream-images.js';
import { NodeApiService } from '../../src/services/node-api.js';
import { resolveFfmpegBinaries } from '../../src/utils/ffmpeg-path.js';
import { S3Service } from '../../src/services/s3.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { siloFixture, type SiloFixture } from '../support/silo.js';

// Opt in alongside the existing real-FFmpeg HLS checks.
describe.skipIf(process.env['MOARTUBE_TEST_HLS'] !== '1')(
  'live image pipeline with real FFmpeg and HTTP uploads',
  () => {
    it.each(['filesystem', 's3provider'] as const)(
      'uploads a ready thumbnail, preview and poster from each segment using %s',
      async (storageMode) => {
        const root = await mkdtemp(path.join(tmpdir(), 'moartube-live-images-'));
        if (
          path.dirname(root) !== path.resolve(tmpdir()) ||
          !path.basename(root).startsWith('moartube-live-images-')
        ) {
          throw new Error('Unexpected image test directory');
        }
        const { ffmpeg } = resolveFfmpegBinaries();
        const { inspectInput } = createRequire(import.meta.url)(
          '../../src/utils/image-runtime/input.cjs'
        ) as {
          inspectInput: (bytes: Buffer) => { width: number; height: number };
        };
        const app = Fastify();
        const received: Array<{ name: string; bytes: Buffer }> = [];
        const events: unknown[] = [];
        const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
        let http: NodeApiService | undefined;
        let images: LiveStreamImages | undefined;
        let silo: SiloFixture | undefined;
        const s3 = new S3Service(logger as never);
        const aborter = new AbortController();
        try {
          if (storageMode === 's3provider') {
            silo = await siloFixture();
          }
          await app.register(multipart);
          app.post('/videos/:videoId/images/:name', async (request) => {
            const part = await request.file();
            if (part === undefined) {
              throw new Error('Missing uploaded image');
            }
            received.push({
              name: (request.params as { name: string }).name,
              bytes: await part.toBuffer(),
            });
            return { isError: false };
          });
          app.post('/videos/:videoId/activity', () => ({ isError: false }));
          app.post('/videos/:videoId/cache/invalidate', async (request) => {
            if (silo === undefined) {
              throw new Error('Missing real S3 fixture');
            }
            const { paths } = request.body as { paths: string[] };
            for (const image of paths) {
              const result = await silo.client.send(
                new GetObjectCommand({
                  Bucket: silo.config.bucketName,
                  Key: 'external/videos/video/' + image,
                })
              );
              if (result.Body === undefined) {
                throw new Error('Image object was not uploaded before invalidation');
              }
              received.push({
                name: path.basename(image, '.jpg'),
                bytes: Buffer.from(await result.Body.transformToByteArray()),
              });
            }
            return { isError: false };
          });
          await app.listen({ host: '127.0.0.1', port: 0 });
          const address = app.server.address();
          if (address === null || typeof address === 'string') {
            throw new Error('Missing test HTTP port');
          }
          http = new NodeApiService(
            logger as never,
            {
              clientSettings: {
                nodeHttpProtocol: 'http',
                nodeIp: '127.0.0.1',
                nodePort: address.port,
              },
            } as never
          );
          execFileSync(
            ffmpeg,
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-f',
              'lavfi',
              '-i',
              'testsrc2=size=426x240:rate=30',
              '-t',
              '6',
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
              '-threads',
              '1',
              '-g',
              '90',
              '-f',
              'hls',
              '-hls_time',
              '3',
              '-hls_list_size',
              '0',
              '-hls_segment_filename',
              path.join(root, 'segment-%d.ts'),
              path.join(root, 'live.m3u8'),
            ],
            { windowsHide: true, timeout: 15_000 }
          );
          images = new LiveStreamImages({
            jwtToken: 'test',
            videoId: 'video',
            signal: aborter.signal,
            ffmpegPath: ffmpeg,
            storageConfig: { storageMode, ...(silo ? { s3Config: silo.config } : {}) } as never,
            logger: logger as never,
            nodeApiService: http,
            s3Service: s3,
            socketService: {
              broadcastToUser: (_key: string, _event: string, data: unknown): void => {
                events.push(data);
              },
            } as never,
          });
          images.enqueue(await readFile(path.join(root, 'segment-0.ts')));
          await vi.waitFor(
            () => {
              expect(events).toHaveLength(2);
            },
            { timeout: 10_000 }
          );
          images.enqueue(await readFile(path.join(root, 'segment-1.ts')));
          await images.finish();
          expect(logger.error).not.toHaveBeenCalled();
          expect(received.map(({ name }) => name)).toEqual([
            'thumbnail',
            'preview',
            'poster',
            'thumbnail',
            'preview',
            'poster',
          ]);
          expect(received.map(({ bytes }) => inspectInput(bytes))).toMatchObject([
            { width: 100, height: 100 },
            { width: 512, height: 288 },
            { width: 1280, height: 720 },
            { width: 100, height: 100 },
            { width: 512, height: 288 },
            { width: 1280, height: 720 },
          ]);
          expect(events).toHaveLength(4);
        } finally {
          aborter.abort();
          await images?.finish();
          http?.close();
          s3.close();
          await app.close();
          await silo?.close();
          await rm(root, { recursive: true, force: true });
        }
      },
      20_000
    );
  }
);
