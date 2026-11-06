import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { SettingsController } from '../src/controllers/settings.js';
import { NodeApiService } from '../src/services/node-api.js';
import { settingsRoutes } from '../src/routes/settings.js';

it('forwards ordered bulletin arrays and clears them through the actual Client route', async () => {
  const node = Fastify();
  let saved: string[] = [];
  node.post('/settings/personalize/bulletin', (request) => {
    expect(request.headers.authorization).toBe('Bearer token');
    saved = (request.body as { nodeBulletin: string[] }).nodeBulletin;
    return { isError: false, nodeBulletin: saved };
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
    for (const nodeBulletin of [[' One ', 'Two'], []]) {
      const response = await client.inject({
        method: 'POST',
        url: '/settings/node/personalize/bulletin',
        payload: { nodeBulletin },
      });
      expect(response.statusCode).toBe(200);
      expect(saved).toEqual(nodeBulletin.map((item) => item.trim()));
      expect(response.json()).toEqual({ isError: false, nodeBulletin: saved });
    }
    for (const nodeBulletin of [
      null,
      'text',
      [1],
      [' '],
      ['x'.repeat(1001)],
      Array(51).fill('x'),
    ]) {
      expect(
        (
          await client.inject({
            method: 'POST',
            url: '/settings/node/personalize/bulletin',
            payload: { nodeBulletin },
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
    setNodeBulletin: vi.fn().mockRejectedValue(new Error('Private transport details')),
  };
  const controller = new SettingsController({} as never, api as never, {} as never, {} as never);
  const app = Fastify();
  let token = '';
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: token } as never;
    done();
  });
  app.post('/bulletin', controller.apiSetNodeBulletin);
  try {
    const payload = { nodeBulletin: ['Draft'] };
    expect((await app.inject({ method: 'POST', url: '/bulletin', payload })).statusCode).toBe(401);
    expect(api.setNodeBulletin).not.toHaveBeenCalled();
    token = 'token';
    const response = await app.inject({ method: 'POST', url: '/bulletin', payload });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('Private transport details');
  } finally {
    await app.close();
  }
});
