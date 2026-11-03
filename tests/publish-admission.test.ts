import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeApiService } from '../src/services/node-api.js';
import type { Config } from '../src/config/index.js';
import type { Logger } from '../src/utils/logger.js';
import { VideoPublishService } from '../src/services/video-publish.js';

const fixtures: { api: NodeApiService; server: http.Server }[] = [];
const publishers: VideoPublishService[] = [];
const directories: string[] = [];

async function connect(handler: http.RequestListener): Promise<NodeApiService> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = new NodeApiService(
    {} as Logger,
    {
      clientSettings: {
        nodeHttpProtocol: 'http',
        nodeIp: '127.0.0.1',
        nodePort: (server.address() as { port: number }).port,
      },
    } as Config
  );
  fixtures.push({ api, server });
  return api;
}

afterEach(async () => {
  publishers.splice(0).forEach((publisher) => {
    publisher.close();
  });
  for (const { api, server } of fixtures.splice(0)) {
    api.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      })
    );
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('publishing admission serialization', () => {
  it('publishes six jobs with two encoders and no admission retries', async () => {
    let busy = false,
      rejected = 0,
      admissions = 0;
    const api = await connect((request, response) => {
      request.resume();
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json');
        if (request.url === '/external/videos/baseUrl') {
          response.end(
            JSON.stringify({ isError: false, externalVideosBaseUrl: 'https://current.test' })
          );
          return;
        }
        if (request.url !== '/videos/publishing') {
          response.end(JSON.stringify({ isError: false }));
          return;
        }
        admissions++;
        if (busy) {
          rejected++;
          response.writeHead(500);
          response.end(JSON.stringify({ isError: true, message: 'admission lock busy' }));
          return;
        }
        busy = true;
        setTimeout(() => {
          busy = false;
          response.end(JSON.stringify({ isError: false }));
        }, 25);
      });
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const directory = await mkdtemp(path.join(tmpdir(), 'moartube-publish-admission-'));
    directories.push(directory);
    const manifests = path.join(directory, 'video', 'adaptive', 'm3u8');
    await mkdir(manifests, { recursive: true });
    for (const resolution of ['480p', '360p', '240p']) {
      await writeFile(
        path.join(manifests, `manifest-${resolution}.m3u8`),
        `#EXTM3U\n#EXTINF:2,\nhttps://previous.test/external/videos/video/adaptive/m3u8/${resolution}/segments/one.ts\n#EXT-X-ENDLIST\n`
      );
    }
    const socket = {
      broadcastToUser:
        vi.fn<(_token: string, _event: string, data: { payload: { stage?: string } }) => void>(),
    };
    const publisher = new VideoPublishService(
      logger as never,
      api,
      {} as never,
      { getVideosDirectoryPath: () => directory } as never,
      socket as never,
      {} as never,
      {} as never
    );
    publishers.push(publisher);
    const internal = publisher as unknown as {
      performEncodingJob: () => Promise<void>;
      performUploadingJob: () => Promise<void>;
      finishVideoPublish: () => Promise<void>;
    };
    let active = 0,
      peak = 0;
    vi.spyOn(internal, 'performEncodingJob').mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 80));
      } finally {
        active--;
      }
    });
    vi.spyOn(internal, 'performUploadingJob').mockResolvedValue(undefined);
    vi.spyOn(internal, 'finishVideoPublish').mockResolvedValue(undefined);
    for (const format of ['m3u8', 'mp4'] as const) {
      for (const resolution of ['480p', '360p', '240p']) {
        publisher.enqueuePendingPublishVideo({
          jwtToken: 'token',
          videoId: 'video',
          format,
          resolution,
          sourceFileExtension: '.mp4',
        });
      }
    }
    await vi.waitFor(() => {
      expect(publisher.getPublishingJobs('token', 'video')).toEqual([]);
    });
    expect(admissions).toBe(6);
    expect(rejected).toBe(0);
    expect(peak).toBe(2);
    expect(logger.error).not.toHaveBeenCalled();
    for (const resolution of ['480p', '360p', '240p']) {
      expect(await readFile(path.join(manifests, `manifest-${resolution}.m3u8`), 'utf8')).toContain(
        'https://current.test/external/'
      );
    }
    expect(
      socket.broadcastToUser.mock.calls.some((call) => call[2].payload.stage === 'retrying')
    ).toBe(false);
  });

  it('admits a six-job burst without colliding with a fail-fast Node writer lock', async () => {
    let busy = false,
      rejected = 0;
    const admitted: string[] = [];
    const api = await connect((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json');
        if (busy) {
          rejected++;
          response.writeHead(500);
          response.end(
            JSON.stringify({
              isError: true,
              message: 'Another settings change or job admission is in progress.',
            })
          );
          return;
        }
        busy = true;
        admitted.push((JSON.parse(body) as { videoId: string }).videoId);
        setTimeout(() => {
          busy = false;
          response.end(JSON.stringify({ isError: false }));
        }, 25);
      });
    });
    // Include a different video: the Node writer lock is global, not per video.
    const videos = ['video-a', 'video-a', 'video-a', 'video-b', 'video-b', 'video-b'];
    const results = await Promise.allSettled(
      videos.map((video) => api.setVideoPublishing('token', video))
    );
    expect(results.map((result) => result.status)).toEqual(videos.map(() => 'fulfilled'));
    expect(rejected).toBe(0);
    expect(admitted).toEqual(videos);
  });

  it('keeps the next admissions moving after a genuine Node rejection', async () => {
    let calls = 0;
    const api = await connect((request, response) => {
      request.resume();
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json');
        const first = calls++ === 0;
        response.writeHead(first ? 500 : 200);
        response.end(JSON.stringify({ isError: first, message: first ? 'genuine failure' : '' }));
      });
    });
    const results = await Promise.allSettled(
      [0, 1, 2].map(() => api.setVideoPublishing('token', 'video'))
    );
    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    expect(calls).toBe(3);
  });

  it('does not block unrelated Node requests behind an admission', async () => {
    let release!: () => void, arrived!: () => void;
    const received = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const api = await connect((request, response) => {
      request.resume();
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/videos/publishing') {
        release = (): void => {
          response.end(JSON.stringify({ isError: false }));
        };
        arrived();
      } else {
        response.end(
          JSON.stringify({ isError: false, externalVideosBaseUrl: 'http://example.invalid' })
        );
      }
    });
    let completed = false;
    const admission = api.setVideoPublishing('token', 'video').then(() => {
      completed = true;
    });
    await received;
    try {
      expect(await api.getExternalVideosBaseUrl('token')).toBe('http://example.invalid');
      expect(completed).toBe(false);
    } finally {
      release();
      await admission;
    }
  });

  it('cancels active and queued admissions on shutdown', async () => {
    let arrived!: () => void,
      calls = 0;
    const received = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const api = await connect((request) => {
      request.resume();
      calls++;
      arrived();
    });
    const results = Promise.allSettled(
      [0, 1, 2].map(() => api.setVideoPublishing('token', 'video'))
    );
    await received;
    api.close();
    expect((await results).map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
    ]);
    expect(calls).toBe(1);
  });
});
