import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { NodeApiService } from '../src/services/node-api.js';
import { settingsRoutes } from '../src/routes/settings.js';

it('saves independent network settings, authenticates writes and preserves Node failures without restarting', async () => {
  const node = Fastify();
  const client = Fastify();
  let authorized = true;
  let rejectSave = false;
  const received = vi.fn();
  const restart = vi.fn();
  node.get('/account/authenticated', () => ({ isError: false, isAuthenticated: authorized }));
  node.post('/settings/network/access', (request, reply) => {
    received(request.body, request.headers.authorization);
    return rejectSave
      ? reply.code(500).send({ isError: true, message: 'Node settings could not be written.' })
      : { isError: false, restartRequired: true };
  });
  node.post('/settings/restart', restart);
  await node.listen({ host: '127.0.0.1', port: 0 });
  const config = {
    clientSettings: {
      nodeIp: '127.0.0.1', nodePort: (node.server.address() as { port: number }).port,
      nodeHttpProtocol: 'http', allowRemoteConnections: false,
    },
    saveClientSettings: vi.fn(),
  };
  const api = new NodeApiService(
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    config as never
  );
  let signedIn = true;
  client.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: signedIn ? 'token' : '' } as never;
    done();
  });
  const dependencies = { config, nodeApiService: api, s3Service: {}, ffmpegService: {} };
  await client.register((app, _opts, done) => {
    settingsRoutes(app, { resolve: (key: keyof typeof dependencies) => dependencies[key] } as never);
    done();
  }, { prefix: '/settings' });
  const save = (target: string, payload: unknown) => client.inject({
    method: 'POST', url: `/settings/${target}/network/access`, payload: payload as object,
  });
  try {
    for (const enabled of [true, false]) {
      expect((await save('client', { allowRemoteConnections: enabled })).json()).toEqual({ isError: false, restartRequired: true });
      expect(config.saveClientSettings).toHaveBeenLastCalledWith({ allowRemoteConnections: enabled });
      expect((await save('node', { allowRemoteConnections: enabled })).json()).toEqual({ isError: false, restartRequired: true });
      expect(received).toHaveBeenLastCalledWith({ allowRemoteConnections: enabled }, 'Bearer token');
    }
    expect(restart).not.toHaveBeenCalled();
    for (const target of ['client', 'node']) {
      for (const payload of [{}, { allowRemoteConnections: 'false' }, { allowRemoteConnections: 1 }]) {
        expect((await save(target, payload)).statusCode).toBe(400);
      }
    }
    authorized = false;
    config.saveClientSettings.mockClear();
    expect((await save('client', { allowRemoteConnections: true })).statusCode).toBe(401);
    expect(config.saveClientSettings).not.toHaveBeenCalled();
    rejectSave = true;
    expect((await save('node', { allowRemoteConnections: false })).json()).toMatchObject({ isError: true, message: 'Node settings could not be written.' });
    signedIn = false;
    for (const target of ['client', 'node']) expect((await save(target, { allowRemoteConnections: true })).statusCode).toBe(401);
  } finally {
    api.close();
    await client.close();
    await node.close();
  }
});
