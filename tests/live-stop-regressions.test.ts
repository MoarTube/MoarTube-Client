import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { LiveStreamService } from '../src/services/live-stream.js';
import { StreamsController } from '../src/controllers/streams.js';
import { NodeApiService } from '../src/services/node-api.js';
import { DEFAULT_CLIENT_SETTINGS } from '../src/config/defaults.js';
import { spawnMediaProcess } from '../src/utils/media-processes.js';

// Encoder and unrelated API dependencies are isolated; HLS files and stop HTTP calls are real.
vi.mock('../src/services/live-stream-images.js', () => ({
  LiveStreamImages: class {
    enqueue(): void {}
    finish(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('../src/utils/media-processes.js', () => ({ spawnMediaProcess: vi.fn() }));

describe('Client stop drain contract', () => {
  it.each(['explicit', 'natural', 'delivery failure'] as const)(
    'sends the observed playback window to Node exactly once on %s stop',
    async (mode) => {
      const root = await mkdtemp(path.join(tmpdir(), 'moartube-live-stop-'));
      const received: unknown[] = [];
      const app = Fastify();
      app.post('/streams/:videoId/stop', (request) => {
        received.push(request.body);
        return { isError: false };
      });
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing HTTP port');
      }
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const http = new NodeApiService(
        logger as never,
        {
          clientSettings: { nodeHttpProtocol: 'http', nodeIp: '127.0.0.1', nodePort: address.port },
        } as never
      );
      const api = {
        getNodeSettings: vi.fn().mockResolvedValue({
          storageConfig: { storageMode: 'filesystem' },
          isCloudflareCdnEnabled: true,
        }),
        getExternalVideosBaseUrl: vi.fn().mockResolvedValue('https://node.example'),
        uploadStream: vi.fn().mockResolvedValue({ isError: false }),
        getVideoBandwidth: vi.fn().mockResolvedValue({ isError: true }),
        stopVideoStreaming: http.stopVideoStreaming.bind(http),
      };
      const deliveryError = new Error('Node upload connection reset');
      if (mode === 'delivery failure') {
        api.uploadStream.mockRejectedValue(deliveryError);
      }
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        signalCode: null as string | null,
        kill: vi.fn(() => {
          child.signalCode = 'SIGTERM';
          queueMicrotask(() => child.emit('close', 0));
          return true;
        }),
      });
      vi.mocked(spawnMediaProcess).mockImplementation((_command, args) => {
        const playlist = String(args.at(-1));
        writeFileSync(path.join(path.dirname(playlist), 'segment-720p-0.ts'), 'older viewer bytes');
        writeFileSync(
          playlist,
          '#EXTM3U\n#EXT-X-TARGETDURATION:40\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:40,\nhttps://node.example/external/videos/video/adaptive/m3u8/720p/segments/segment-720p-0.ts\n'
        );
        return child as never;
      });
      const service = new LiveStreamService(
        logger as never,
        api as never,
        {} as never,
        {
          getVideosDirectoryPath: () => root,
          getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
        } as never,
        { broadcastToUser: vi.fn() } as never,
        { refreshMasterManifest: () => Promise.resolve() } as never,
        { getPath: () => 'test-encoder' } as never
      );
      try {
        await service.performStreamingJob(
          'token',
          'video',
          'rtmp://127.0.0.1/live',
          'm3u8',
          '720p',
          false,
          false
        );
        await vi.waitFor(() => {
          expect(api.uploadStream).toHaveBeenCalledOnce();
        });
        if (mode === 'explicit') {
          const controller = new StreamsController(
            service,
            api as never,
            { sendVideoStatusEcho: vi.fn() } as never
          );
          const reply = { send: vi.fn().mockReturnThis() };
          await controller.stopStream(
            { params: { videoId: 'video' }, session: { jwtToken: 'token' } } as never,
            reply as never
          );
        } else if (mode === 'natural') {
          child.exitCode = 0;
          child.emit('close', 0);
        }
        await vi.waitFor(() => {
          expect(received).toEqual([{ drainSeconds: mode === 'delivery failure' ? 6 : 86 }]);
        });
        await vi.waitFor(() => {
          expect(service.liveStreamExists('video')).toBe(false);
        });
        if (mode === 'delivery failure') {
          expect(child.kill).toHaveBeenCalledOnce();
          expect(logger.error).toHaveBeenCalledExactlyOnceWith(
            'Live delivery failed for video video; terminating encoder',
            deliveryError
          );
          expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('after delivery failure')
          );
        } else {
          expect(logger.error).not.toHaveBeenCalled();
        }
      } finally {
        service.close();
        http.close();
        await app.close();
        await rm(root, { recursive: true, force: true });
        vi.mocked(spawnMediaProcess).mockReset();
      }
    }
  );
});
