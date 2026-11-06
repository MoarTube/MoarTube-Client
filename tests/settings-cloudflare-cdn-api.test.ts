import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { NodeApiService } from '../src/services/node-api.js';
import { SettingsController } from '../src/controllers/settings.js';

describe('CDN configuration proxy contract', () => {
  it('reports an unreachable Node during recovery without exposing internal errors', async () => {
    const api = {
      retryCloudflareConfiguration: vi.fn().mockRejectedValue(new Error('internal secret')),
    };
    const app = Fastify();
    const controller = new SettingsController({} as never, api as never, {} as never, {} as never);
    app.addHook('onRequest', (request, _reply, done) => {
      request.session = { jwtToken: 'test' } as never;
      done();
    });
    app.post('/retry', controller.apiRetryCloudflareConfig);
    try {
      const result = await app.inject({
        method: 'POST',
        url: '/retry',
        payload: { transitionId: 'transition' },
      });
      expect(result.statusCode).toBe(502);
      expect(result.json()).toMatchObject({ isError: true });
      expect(result.body).not.toContain('internal secret');
    } finally {
      await app.close();
    }
  });

  it('forwards only credentials and preserves partial-save HTTP responses for configure and clear', async () => {
    const node = Fastify();
    const app = Fastify();
    const response = {
      isError: true,
      settingsSaved: true,
      cloudflareAddressMigrationPending: true,
      isCloudflareCdnEnabled: true,
      isCloudflareTunnelEnabled: false,
      cloudflareTunnelName: 'Named',
      tunnel: { mode: 'none', status: 'error', name: '' },
    };
    node.post('/settings/cloudflare/configure', (request, reply) => {
      expect(request.headers.authorization).toBe('Bearer test');
      expect(request.body).toEqual({
        cloudflareEmailAddress: 'email',
        cloudflareZoneId: 'zone',
        cloudflareGlobalApiKey: 'key',
      });
      return reply.code(502).send(response);
    });
    node.post('/settings/cloudflare/clear', (request, reply) => {
      expect(request.headers.authorization).toBe('Bearer test');
      return reply.code(502).send({ ...response, isCloudflareCdnEnabled: false });
    });
    node.post('/settings/cloudflare/retry', (request, reply) => {
      expect(request.headers.authorization).toBe('Bearer test');
      expect(request.body).toEqual({ transitionId: 'transition' });
      return reply.code(502).send(response);
    });
    await node.listen({ host: '127.0.0.1', port: 0 });
    const api = new NodeApiService(
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      {
        clientSettings: {
          nodeHttpProtocol: 'http',
          nodeIp: '127.0.0.1',
          nodePort: (node.server.address() as { port: number }).port,
        },
      } as never
    );
    const controller = new SettingsController({} as never, api, {} as never, {} as never);
    app.addHook('onRequest', (request, _reply, done) => {
      request.session = { jwtToken: 'test' } as never;
      done();
    });
    app.post('/configure', controller.apiSetCloudflareConfig);
    app.post('/clear', controller.apiClearCloudflareConfig);
    app.post('/retry', controller.apiRetryCloudflareConfig);
    try {
      for (const credentials of [
        null,
        {},
        { cloudflareEmailAddress: 'email' },
        { cloudflareEmailAddress: 'email', cloudflareZoneId: 'zone' },
      ]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/configure',
              payload: credentials,
            })
          ).statusCode
        ).toBe(400);
      }
      const result = await app.inject({
        method: 'POST',
        url: '/configure',
        payload: {
          cloudflareEmailAddress: 'email',
          cloudflareZoneId: 'zone',
          cloudflareGlobalApiKey: 'key',
        },
      });
      expect(result.statusCode).toBe(502);
      expect(result.json()).toEqual(response);
      expect(result.headers['cache-control']).toBe('no-store');
      const cleared = await app.inject({ method: 'POST', url: '/clear', payload: {} });
      expect(cleared.statusCode).toBe(502);
      expect(cleared.json()).toMatchObject({ settingsSaved: true, isCloudflareCdnEnabled: false });
      const retried = await app.inject({
        method: 'POST',
        url: '/retry',
        payload: { transitionId: 'transition' },
      });
      expect(retried.statusCode).toBe(502);
      expect(retried.json()).toEqual(response);
      expect(retried.headers['cache-control']).toBe('no-store');
    } finally {
      api.close();
      await app.close();
      await node.close();
    }
  });
  it('rejects missing authentication before sending credentials', async () => {
    const api = { setCloudflareConfiguration: vi.fn(), retryCloudflareConfiguration: vi.fn() };
    const app = Fastify();
    const controller = new SettingsController({} as never, api as never, {} as never, {} as never);
    app.addHook('onRequest', (request, _reply, done) => {
      request.session = {} as never;
      done();
    });
    app.post('/configure', controller.apiSetCloudflareConfig);
    app.post('/retry', controller.apiRetryCloudflareConfig);
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/configure', payload: {} })).statusCode
      ).toBe(401);
      expect(api.setCloudflareConfiguration).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/retry',
            payload: { transitionId: 'transition' },
          })
        ).statusCode
      ).toBe(401);
      expect(api.retryCloudflareConfiguration).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
