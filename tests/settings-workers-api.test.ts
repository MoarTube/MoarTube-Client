import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { NodeApiService } from '../src/services/node-api.js';
import { settingsRoutes } from '../src/routes/settings.js';

it('forwards worker status, counts, confirmation and authentication, and preserves rejection messages', async () => {
  const node = Fastify();
  const client = Fastify();
  let blocked = false;
  const received = vi.fn();
  node.get('/settings/workers', (request) => {
    expect(request.headers.authorization).toBe('Bearer token');
    return { isError: false, workerCount: 4, runningWorkers: 4, maxWorkers: 8 };
  });
  node.post('/settings/workers', (request, reply) => {
    received(request.body, request.headers.authorization);
    return blocked
      ? reply
          .code(409)
          .send({ isError: true, message: 'Stop active uploads before lowering the worker count.' })
      : { isError: false, workerCount: 1, runningWorkers: 1, maxWorkers: 8 };
  });
  await node.listen({ host: '127.0.0.1', port: 0 });
  const address = node.server.address() as { port: number };
  const config = {
    clientSettings: { nodeIp: '127.0.0.1', nodePort: address.port, nodeHttpProtocol: 'http' },
  };
  const api = new NodeApiService(
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    config as never,
  );
  let signedIn = true;
  client.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: signedIn ? 'token' : '' } as never;
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
    { prefix: '/settings' },
  );
  try {
    expect((await client.inject('/settings/node/workers')).json()).toMatchObject({
      maxWorkers: 8,
      runningWorkers: 4,
    });
    const payload = { workerCount: 1, confirmDecrease: true };
    expect(
      (await client.inject({ method: 'POST', url: '/settings/node/workers', payload })).json(),
    ).toMatchObject({ workerCount: 1 });
    expect(received).toHaveBeenCalledExactlyOnceWith(payload, 'Bearer token');
    blocked = true;
    const rejection = await client.inject({
      method: 'POST',
      url: '/settings/node/workers',
      payload,
    });
    expect(rejection.statusCode).toBe(409);
    expect(rejection.json()).toEqual({
      isError: true,
      message: 'Stop active uploads before lowering the worker count.',
    });
    for (const invalid of [
      { workerCount: -1 },
      { workerCount: 1.2 },
      { workerCount: '2' },
      { workerCount: 1, confirmDecrease: 'true' },
    ]) {
      expect(
        (await client.inject({ method: 'POST', url: '/settings/node/workers', payload: invalid }))
          .statusCode,
      ).toBe(400);
    }
    signedIn = false;
    expect(
      (await client.inject({ method: 'POST', url: '/settings/node/workers', payload })).statusCode,
    ).toBe(401);
  } finally {
    api.close();
    await client.close();
    await node.close();
  }
});
