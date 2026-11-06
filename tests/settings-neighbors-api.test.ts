import type { NodeNeighbor } from '../src/types/node-api.js';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { SettingsController } from '../src/controllers/settings.js';
import { NodeApiService } from '../src/services/node-api.js';
import { settingsRoutes } from '../src/routes/settings.js';

it('forwards ordered neighbors arrays and clears them through the actual Client route', async () => {
  const node = Fastify();
  let saved: NodeNeighbor[] = [];
  node.post('/settings/personalize/neighbors', (request) => {
    expect(request.headers.authorization).toBe('Bearer token');
    saved = (request.body as { nodeNeighbors: NodeNeighbor[] }).nodeNeighbors;
    return { isError: false, nodeNeighbors: saved };
  });
  await node.listen({ host: '127.0.0.1', port: 0 });
  const address = node.server.address() as { port: number };
  const config = {
    clientSettings: { nodeIp: '127.0.0.1', nodePort: address.port, nodeHttpProtocol: 'http' },
  };
  const api = new NodeApiService(
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    config as never
  );
  const client = Fastify();
  client.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: 'token' } as never;
    done();
  });
  const dependencies = { config, nodeApiService: api, s3Service: {}, ffmpegService: {} };
  await client.register(
    (app, _options, done) => {
      settingsRoutes(app, {
        resolve: (key: keyof typeof dependencies) => dependencies[key],
      } as never);
      done();
    },
    { prefix: '/settings' }
  );
  try {
    for (const nodeNeighbors of [
      [
        { url: ' https://rivet.tube ', description: ' Indie film and art ' },
        { url: 'http://localhost:9090', description: 'Local neighbor' },
      ],
      [],
    ]) {
      const response = await client.inject({
        method: 'POST',
        url: '/settings/node/personalize/neighbors',
        payload: { nodeNeighbors },
      });
      expect(response.statusCode).toBe(200);
      expect(saved).toEqual(
        nodeNeighbors.map((item) => ({
          url: item.url.trim(),
          description: item.description.trim(),
        }))
      );
      expect(response.json()).toEqual({ isError: false, nodeNeighbors: saved });
    }
    for (const nodeNeighbors of [
      null,
      'text',
      [1],
      ['text'],
      [{ url: 'javascript:alert(1)', description: 'Bad protocol' }],
      [{ url: 'ftp://example.com', description: 'Wrong protocol' }],
      [{ url: 'https://rivet.tube' }],
      [{ url: 'rivet.tube', description: 'Incomplete URL' }],
      [{ url: 'https://rivet.tube', description: ' ' }],
      [{ url: 'https://rivet.tube', description: 'x'.repeat(1001) }],
      Array(51).fill({ url: 'https://rivet.tube', description: 'Neighbor' }),
    ]) {
      expect(
        (
          await client.inject({
            method: 'POST',
            url: '/settings/node/personalize/neighbors',
            payload: { nodeNeighbors },
          })
        ).statusCode
      ).toBe(400);
      expect(saved).toEqual([]);
    }
  } finally {
    api.close();
    await client.close();
    await node.close();
  }
});

it('rejects unsigned requests and reports transport failures without losing the draft', async () => {
  const api = {
    setNodeNeighbors: vi.fn().mockRejectedValue(new Error('Private transport details')),
  };
  const controller = new SettingsController({} as never, api as never, {} as never, {} as never);
  const app = Fastify();
  let token = '';
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: token } as never;
    done();
  });
  app.post('/neighbors', controller.apiSetNodeNeighbors);
  try {
    const payload = { nodeNeighbors: [{ url: 'https://rivet.tube', description: 'Draft' }] };
    expect((await app.inject({ method: 'POST', url: '/neighbors', payload })).statusCode).toBe(401);
    expect(api.setNodeNeighbors).not.toHaveBeenCalled();
    token = 'token';
    const response = await app.inject({ method: 'POST', url: '/neighbors', payload });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('Private transport details');
  } finally {
    await app.close();
  }
});
