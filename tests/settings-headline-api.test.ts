import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { settingsRoutes } from '../src/routes/settings.js';
import { NodeApiService } from '../src/services/node-api.js';

it.each(['name', 'headline'] as const)('forwards the %s route, payload, and authentication to the Node', async (kind) => {
  const node = Fastify();
  const client = Fastify();
  const payload = kind === 'name' ? { nodeName: 'My node' } : { nodeHeadline: 'My headline' };
  const received = vi.fn();
  node.post(`/settings/personalize/${kind}`, (request) => {
    received(request.body, request.headers.authorization);
    return { isError: false };
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
  const dependencies = { config, nodeApiService: api, s3Service: {}, ffmpegService: {} };
  client.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: 'test-token' } as never;
    done();
  });
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
    const response = await client.inject({
      method: 'POST',
      url: `/settings/node/personalize/${kind}`,
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isError: false });
    expect(received).toHaveBeenCalledExactlyOnceWith(payload, 'Bearer test-token');
  } finally {
    api.close();
    await client.close();
    await node.close();
  }
});
