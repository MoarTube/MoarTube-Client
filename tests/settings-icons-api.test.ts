import type { NodeIcon } from '../src/types/node-api.js';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { SettingsController } from '../src/controllers/settings.js';
import { NodeApiService } from '../src/services/node-api.js';
import { settingsRoutes } from '../src/routes/settings.js';

it('forwards ordered links arrays and clears them through the actual Client route', async () => {
  const node = Fastify();
  let saved: NodeIcon[] = [];
  node.post('/settings/personalize/icons', (request) => {
    expect(request.headers.authorization).toBe('Bearer token');
    saved = (request.body as { nodeIcons: NodeIcon[] }).nodeIcons;
    return { isError: false, nodeIcons: saved };
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
    for (const nodeIcons of [
      [
        { url: ' https://rivet.tube ', svgGraphic: ' <svg/> ' },
        { url: 'http://localhost:9090', svgGraphic: '<svg></svg>' },
      ],
      Array.from({ length: 5 }, () => ({ url: 'https://rivet.tube', svgGraphic: '<svg/>' })),
      [],
    ]) {
      const response = await client.inject({
        method: 'POST',
        url: '/settings/node/personalize/icons',
        payload: { nodeIcons },
      });
      expect(response.statusCode).toBe(200);
      expect(saved).toEqual(
        nodeIcons.map((item) => ({
          url: item.url.trim(),
          svgGraphic: item.svgGraphic.trim(),
        }))
      );
      expect(response.json()).toEqual({ isError: false, nodeIcons: saved });
    }
    for (const nodeIcons of [
      null,
      'text',
      [1],
      ['text'],
      [{ url: 'javascript:alert(1)', svgGraphic: 'Bad protocol' }],
      [{ url: 'ftp://example.com', svgGraphic: 'Wrong protocol' }],
      [{ url: 'https://rivet.tube' }],
      [{ url: 'rivet.tube', svgGraphic: 'Incomplete URL' }],
      [{ url: 'https://rivet.tube', svgGraphic: ' ' }],
      [{ url: 'https://rivet.tube', svgGraphic: 'x'.repeat(50001) }],
      Array(6).fill({ url: 'https://rivet.tube', svgGraphic: '<svg/>' }),
    ]) {
      expect(
        (
          await client.inject({
            method: 'POST',
            url: '/settings/node/personalize/icons',
            payload: { nodeIcons },
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
    setNodeIcons: vi.fn().mockRejectedValue(new Error('Private transport details')),
  };
  const controller = new SettingsController({} as never, api as never, {} as never, {} as never);
  const app = Fastify();
  let token = '';
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: token } as never;
    done();
  });
  app.post('/icons', controller.apiSetNodeIcons);
  try {
    const payload = { nodeIcons: [{ url: 'https://rivet.tube', svgGraphic: '<svg/>' }] };
    expect((await app.inject({ method: 'POST', url: '/icons', payload })).statusCode).toBe(401);
    expect(api.setNodeIcons).not.toHaveBeenCalled();
    token = 'token';
    const response = await app.inject({ method: 'POST', url: '/icons', payload });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('Private transport details');
  } finally {
    await app.close();
  }
});
