import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { SettingsController } from '../src/controllers/settings.js';
import { NodeApiService } from '../src/services/node-api.js';

describe('Client tunnel proxy', () => {
  it('preserves saved-preference failures and bearer authentication across the actual HTTP service', async () => {
    const node = Fastify();
    const client = Fastify();
    const body = {
      isError: true,
      settingsSaved: true,
      isCloudflareTunnelEnabled: false,
      isCloudflareCdnEnabled: false,
      cloudflareTunnelName: 'random',
      tunnel: { mode: 'quick', status: 'error', name: '' },
      message: 'Preference saved; stop failed',
    };
    node.post('/settings/cloudflare/tunnel/toggle', (request, reply) => {
      expect(request.headers.authorization).toBe('Bearer test-token');
      expect(request.body).toEqual({ isEnabled: false });
      return reply.code(502).send(body);
    });
    node.get('/settings/cloudflare/tunnel', (request) => {
      expect(request.headers.authorization).toBe('Bearer test-token');
      return { isError: false, tunnel: body.tunnel };
    });
    await node.listen({ host: '127.0.0.1', port: 0 });
    const address = node.server.address() as { port: number };
    const api = new NodeApiService(
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      {
        clientSettings: { nodeIp: '127.0.0.1', nodePort: address.port, nodeHttpProtocol: 'http' },
      } as never
    );
    const controller = new SettingsController({} as never, api, {} as never, {} as never);
    client.addHook('onRequest', (request, _reply, done) => {
      request.session = { jwtToken: 'test-token' } as never;
      done();
    });
    client.post('/toggle', controller.apiSetCloudflareTunnelEnabled);
    client.get('/status', controller.apiGetCloudflareTunnel);
    try {
      const response = await client.inject({
        method: 'POST',
        url: '/toggle',
        payload: { isEnabled: false },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual(body);
      expect(response.headers['cache-control']).toBe('no-store');
      expect((await client.inject('/status')).json()).toEqual({
        isError: false,
        tunnel: body.tunnel,
      });
      expect(
        (await client.inject({ method: 'POST', url: '/toggle', payload: { isEnabled: 'false' } }))
          .statusCode
      ).toBe(400);
    } finally {
      api.close();
      await client.close();
      await node.close();
    }
  });
  it('rejects unsigned requests and hides transport errors', async () => {
    const api = {
      setCloudflareTunnelEnabled: vi.fn().mockRejectedValue(new Error('private-key')),
      getCloudflareTunnel: vi.fn(),
    };
    const controller = new SettingsController({} as never, api as never, {} as never, {} as never);
    const app = Fastify();
    let signedIn = false;
    app.addHook('onRequest', (request, _reply, done) => {
      request.session = { jwtToken: signedIn ? 'token' : '' } as never;
      done();
    });
    app.post('/toggle', controller.apiSetCloudflareTunnelEnabled);
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/toggle', payload: { isEnabled: false } }))
          .statusCode
      ).toBe(401);
      expect(api.setCloudflareTunnelEnabled).not.toHaveBeenCalled();
      signedIn = true;
      const response = await app.inject({
        method: 'POST',
        url: '/toggle',
        payload: { isEnabled: false },
      });
      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain('private-key');
    } finally {
      await app.close();
    }
  });
});
