import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { SettingsController } from '../src/controllers/settings.js';
import type { Config } from '../src/config/index.js';
import type { NodeApiService } from '../src/services/node-api.js';
import type { S3Service } from '../src/services/s3.js';
import type { FfmpegService } from '../src/services/ffmpeg.js';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
});
function setup(
  bundled = true,
  failure = false
): {
  saveClientSettings: ReturnType<typeof vi.fn>;
  setAccountCredentials: ReturnType<typeof vi.fn>;
} {
  vi.stubEnv('MOARTUBE_BUNDLED_NODE_PORT', bundled ? '32123' : undefined);
  vi.stubEnv('MOARTUBE_DESKTOP_MODE', bundled ? 'packaged' : undefined);
  const saveClientSettings = vi.fn();
  const setAccountCredentials = vi.fn().mockResolvedValue({ isError: failure });
  const controller = new SettingsController(
    { saveClientSettings } as unknown as Config,
    { setAccountCredentials } as unknown as NodeApiService,
    {} as S3Service,
    {} as FfmpegService
  );
  app = fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: 'existing-session' } as typeof request.session;
    done();
  });
  app.post('/credentials', controller.apiSetAccountCredentials);
  return { saveClientSettings, setAccountCredentials };
}
describe('bundled Node credential settings', () => {
  it('saves credentials on the Node and only the next-start login mode on the Client', async () => {
    const { saveClientSettings, setAccountCredentials } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/credentials',
      payload: { username: 'owner', password: 'secret' },
    });
    expect(response.json<{ isError: boolean }>().isError).toBe(false);
    expect(setAccountCredentials).toHaveBeenCalledExactlyOnceWith(
      'existing-session',
      'owner',
      'secret'
    );
    expect(saveClientSettings).toHaveBeenCalledExactlyOnceWith({ bundledNodeLoginRequired: true });
  });
  it('clearing both fields restores automatic credentials and next-start automatic login', async () => {
    const { saveClientSettings, setAccountCredentials } = setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/credentials',
          payload: { username: '', password: '' },
        })
      ).json<{ isError: boolean }>().isError
    ).toBe(false);
    expect(setAccountCredentials).toHaveBeenCalledExactlyOnceWith(
      'existing-session',
      'admin',
      'admin'
    );
    expect(saveClientSettings).toHaveBeenCalledExactlyOnceWith({ bundledNodeLoginRequired: false });
  });
  it('rejects half-empty credentials without changing either side', async () => {
    const { saveClientSettings, setAccountCredentials } = setup();
    for (const payload of [
      { username: '', password: 'secret' },
      { username: 'owner', password: '' },
    ]) {
      expect((await app.inject({ method: 'POST', url: '/credentials', payload })).statusCode).toBe(
        400
      );
    }
    expect(saveClientSettings).not.toHaveBeenCalled();
    expect(setAccountCredentials).not.toHaveBeenCalled();
  });
  it('preserves the login mode when the Node rejects the credential change', async () => {
    const { saveClientSettings } = setup(true, true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/credentials',
          payload: { username: 'owner', password: 'secret' },
        })
      ).json<{ isError: boolean }>().isError
    ).toBe(true);
    expect(saveClientSettings).not.toHaveBeenCalled();
  });
  it('keeps normal Client credential changes separate from bundled login settings', async () => {
    const { saveClientSettings, setAccountCredentials } = setup(false);
    await app.inject({
      method: 'POST',
      url: '/credentials',
      payload: { username: 'owner', password: 'secret' },
    });
    expect(setAccountCredentials).toHaveBeenCalledExactlyOnceWith(
      'existing-session',
      'owner',
      'secret'
    );
    expect(saveClientSettings).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/credentials',
          payload: { username: '', password: '' },
        })
      ).statusCode
    ).toBe(400);
  });
});
