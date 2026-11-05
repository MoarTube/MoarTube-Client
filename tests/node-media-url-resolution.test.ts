import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { NodeApiService } from '../src/services/node-api.js';

describe('Client media URL resolution', () => {
  it('resolves Node-relative media against the connected Node, preserving external S3/CDN URLs and errors', async () => {
    const node = Fastify();
    let base = '';
    let rejected = false;
    node.get('/external/videos/baseUrl', () => ({ isError: false, externalVideosBaseUrl: base }));
    node.get('/videos/video/sources', () =>
      rejected
        ? { isError: true, message: 'unavailable' }
        : {
            isError: false,
            adaptiveSources: [
              {
                src: '/external/videos/video/adaptive/m3u8/static/manifests/manifest-master.m3u8',
                type: 'application/vnd.apple.mpegurl',
              },
            ],
            progressiveSources: [
              {
                src: 'https://media.example.com/bucket/video.mp4?signature=preserved',
                type: 'video/mp4',
              },
            ],
          }
    );
    await node.listen({ host: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${String((node.server.address() as { port: number }).port)}`;
    const config = {
      clientSettings: {
        nodeHttpProtocol: 'http',
        nodeIp: '127.0.0.1',
        nodePort: (node.server.address() as { port: number }).port,
      },
    };
    const api = new NodeApiService(
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      config as never
    );
    try {
      expect(await api.getExternalVideosBaseUrl('token')).toBe(origin);
      const sources = await api.getVideoSources('video');
      expect(sources.adaptiveSources[0]?.src).toBe(
        origin + '/external/videos/video/adaptive/m3u8/static/manifests/manifest-master.m3u8'
      );
      expect(sources.progressiveSources[0]?.src).toBe(
        'https://media.example.com/bucket/video.mp4?signature=preserved'
      );
      base = 'https://s3.example.com/bucket';
      expect(await api.getExternalVideosBaseUrl('token')).toBe(base);
      rejected = true;
      expect(await api.getVideoSources('video')).toEqual({ isError: true, message: 'unavailable' });
      config.clientSettings.nodeIp = '::1';
      expect(await (api as unknown as { getBaseUrl(): Promise<string> }).getBaseUrl()).toBe(
        `http://[::1]:${String(config.clientSettings.nodePort)}`
      );
    } finally {
      api.close();
      await node.close();
    }
  });
});
