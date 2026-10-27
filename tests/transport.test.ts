import { afterEach, describe, expect, it } from 'vitest';
import http, { type Agent } from 'node:http';
import type { AxiosInstance } from 'axios';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeApiService } from '../src/services/node-api.js';
import type { Config } from '../src/config/index.js';
import type { Logger } from '../src/utils/logger.js';

const services: NodeApiService[] = [];
afterEach(() => {
  services.splice(0).forEach((service) => {
    service.close();
  });
});

describe('Node API transport', () => {
  it('cancels stalled live uploads when their stream is stopped', async () => {
    let arrived!: () => void;
    const received = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const server = http.createServer((req) => {
      req.resume();
      req.on('end', arrived);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    try {
      const service = new NodeApiService(
        {} as Logger,
        {
          clientSettings: {
            nodeHttpProtocol: 'http',
            nodeIp: '127.0.0.1',
            nodePort: (server.address() as { port: number }).port,
          },
        } as Config
      );
      services.push(service);
      const upload = service
        .uploadStream('token', {
          videoId: 'video',
          format: 'm3u8',
          resolution: '720p',
          manifestBuffer: Buffer.from('#EXTM3U'),
          segmentBuffer: Buffer.from('segment'),
          manifestFileName: 'manifest.m3u8',
          segmentFileName: 'segment.ts',
          signal: controller.signal,
        } as never)
        .then(
          () => 'resolved',
          () => 'rejected'
        );
      await received;
      controller.abort();
      expect(
        await Promise.race([
          upload,
          new Promise((resolve) =>
            setTimeout(() => {
              resolve('pending');
            }, 250)
          ),
        ])
      ).toBe('rejected');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });
  it('batches many segment files and publishes the manifest only after segments', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'moartube-batch-test-'));
    const requests: string[][] = [];
    const server = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on('data', (chunk: Buffer) => parts.push(chunk));
      req.on('end', () => {
        requests.push(
          [
            ...Buffer.concat(parts)
              .toString()
              .matchAll(/filename="([^"]+)"/g),
          ].map((match) => String(match[1]))
        );
        res.setHeader('Content-Type', 'application/json');
        res.end('{"isError":false}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const files = [];
      for (let i = 0; i < 66; i++) {
        const fileName = i === 0 ? 'manifest-720p.m3u8' : `segment-${String(i)}.ts`;
        const filePath = path.join(directory, fileName);
        await writeFile(filePath, 'content');
        files.push({
          fileName,
          filePath,
          contentType: i === 0 ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        });
      }
      const service = new NodeApiService(
        {} as Logger,
        {
          clientSettings: {
            nodeHttpProtocol: 'http',
            nodeIp: '127.0.0.1',
            nodePort: (server.address() as { port: number }).port,
          },
        } as Config
      );
      services.push(service);
      await service.uploadVideo('token', 'video', 'm3u8', '720p', files);
      expect(requests.length).toBeGreaterThan(1);
      expect(Math.max(...requests.map((request) => request.length))).toBeLessThanOrEqual(64);
      expect(requests.flat()).toHaveLength(66);
      expect(requests.flat().at(-1)).toBe('manifest-720p.m3u8');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
      expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
      expect(path.basename(directory).startsWith('moartube-batch-test-')).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('proxies backup downloads as streams with the existing raw JSON file shape', async () => {
    const payload = '[{"rows":[],"tableName":"videos"}]';
    let requestedUrl = '';
    const server = http.createServer((req, res) => {
      requestedUrl = req.url ?? '';
      res.setHeader('Content-Type', 'application/json');
      res.end(payload);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const service = new NodeApiService(
        {} as Logger,
        {
          clientSettings: {
            nodeHttpProtocol: 'http',
            nodeIp: '127.0.0.1',
            nodePort: (server.address() as { port: number }).port,
          },
        } as Config
      );
      services.push(service);
      const stream = await service.settingsExportDatabase('token');
      expect(stream).toBeInstanceOf(Readable);
      expect(requestedUrl).toContain('download=1');
      let actual = '';
      for await (const chunk of stream) {
        actual += (chunk as Buffer).toString();
      }
      expect(actual).toBe(payload);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });
  it('does not replay a streamed upload to a redirect target', async () => {
    let redirected = false;
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.url === '/again') {
          redirected = true;
          res.end('ok');
        } else {
          res.writeHead(307, { location: '/again' });
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const service = new NodeApiService(
        {} as Logger,
        {
          clientSettings: { nodeHttpProtocol: 'http', nodeIp: '127.0.0.1', nodePort: port },
        } as Config
      );
      services.push(service);
      const client = await (
        service as unknown as { getClient(): Promise<AxiosInstance> }
      ).getClient();
      const response = await client.post('/upload', Readable.from([Buffer.alloc(1024 * 1024)]), {
        proxy: false,
      });
      expect(response.status).toBe(307);
      expect(redirected).toBe(false);
      expect(client.defaults.maxRedirects).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });

  it('reuses bounded agents while reading fresh endpoint settings', async () => {
    const settings = { nodeHttpProtocol: 'http', nodeIp: 'localhost', nodePort: 80 };
    const service = new NodeApiService({} as Logger, { clientSettings: settings } as Config);
    services.push(service);
    const internal = service as unknown as { getClient(): Promise<AxiosInstance> };
    const first = await internal.getClient();
    settings.nodePort = 81;
    const second = await internal.getClient();
    expect(second.defaults.baseURL).toBe('http://localhost:81');
    expect(second.defaults.httpAgent).toBe(first.defaults.httpAgent);
    expect((second.defaults.httpAgent as Agent).maxSockets).toBeLessThanOrEqual(8);
    expect(second.defaults.timeout).toBeGreaterThan(0);
  });
});
