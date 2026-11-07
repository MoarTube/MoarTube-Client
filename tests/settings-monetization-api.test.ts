import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { settingsRoutes } from '../src/routes/settings.js';

it('authenticates wallet operations, validates requests, forwards Node results and handles failures', async () => {
  const api = {
    getMonetizationAll: vi.fn().mockResolvedValue({ isError: false, cryptoWalletAddresses: [] }),
    addMonetizationAddress: vi
      .fn()
      .mockResolvedValue({ isError: false, cryptoWalletAddress: { wallet_address_id: 1 } }),
    deleteMonetizationAddress: vi.fn().mockResolvedValue({ isError: false }),
  };
  const app = Fastify();
  let token = '';
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: token } as never;
    done();
  });
  const dependencies = { config: {}, nodeApiService: api, s3Service: {}, ffmpegService: {} };
  await app.register(
    (instance, _options, done) => {
      settingsRoutes(instance, {
        resolve: (key: keyof typeof dependencies) => dependencies[key],
      } as never);
      done();
    },
    { prefix: '/settings' }
  );
  const base = '/settings/node/personalize/monetization';
  const payload = { walletAddress: ' 0xwallet ', chain: 'ETH', currency: 'ETH' };
  try {
    expect((await app.inject({ url: base })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: base + '/add', payload })).statusCode).toBe(
      401
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: base + '/delete',
          payload: { cryptoWalletAddressId: 1 },
        })
      ).statusCode
    ).toBe(401);
    expect(api.getMonetizationAll).not.toHaveBeenCalled();
    expect(api.addMonetizationAddress).not.toHaveBeenCalled();
    expect(api.deleteMonetizationAddress).not.toHaveBeenCalled();
    token = 'token';
    const loaded = await app.inject({ url: base });
    expect(loaded.json()).toEqual({ isError: false, cryptoWalletAddresses: [] });
    expect(loaded.headers['cache-control']).toBe('no-store');
    for (const invalid of [
      { ...payload, currency: 'BNB' },
      { ...payload, walletAddress: ' ' },
      { ...payload, chain: 'unknown' },
      { ...payload, walletAddress: 'x'.repeat(1001) },
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: base + '/add', payload: invalid })).statusCode
      ).toBe(400);
    }
    expect(api.addMonetizationAddress).not.toHaveBeenCalled();
    expect(
      (await app.inject({ method: 'POST', url: base + '/add', payload })).json<{
        isError: boolean;
      }>().isError
    ).toBe(false);
    expect(api.addMonetizationAddress).toHaveBeenCalledWith('token', '0xwallet', 'ETH', 'ETH');
    for (const id of [-1, 0, 1.5, '1']) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: base + '/delete',
            payload: { cryptoWalletAddressId: id },
          })
        ).statusCode
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: base + '/delete',
          payload: { cryptoWalletAddressId: 1 },
        })
      ).json<{ isError: boolean }>().isError
    ).toBe(false);
    expect(api.deleteMonetizationAddress).toHaveBeenCalledWith('token', 1);
    const countBeforeLimit = api.addMonetizationAddress.mock.calls.length;
    api.getMonetizationAll.mockResolvedValueOnce({
      isError: false,
      cryptoWalletAddresses: Array.from({ length: 10 }, () => ({})),
    } as never);
    const capped = await app.inject({ method: 'POST', url: base + '/add', payload });
    expect(capped.statusCode).toBe(400);
    expect(capped.json<{ message: string }>().message).toContain('10');
    expect(api.addMonetizationAddress).toHaveBeenCalledTimes(countBeforeLimit);
    api.getMonetizationAll.mockResolvedValueOnce({
      isError: false,
      cryptoWalletAddresses: Array.from({ length: 9 }, () => ({})),
    } as never);
    expect((await app.inject({ method: 'POST', url: base + '/add', payload })).statusCode).toBe(
      200
    );
    api.addMonetizationAddress.mockRejectedValue(new Error('Private transport details'));
    const failed = await app.inject({ method: 'POST', url: base + '/add', payload });
    expect(failed.statusCode).toBe(502);
    expect(failed.body).not.toContain('Private transport details');
  } finally {
    await app.close();
  }
});
