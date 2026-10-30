import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyReply } from 'fastify';
import { expect, it } from 'vitest';
import { SettingsController } from '../src/controllers/settings.js';

it.each([undefined, '0.0.1'])(
  'shows the running client version when saved version is %s',
  async (savedVersion) => {
    const packageInfo = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
    const controller = new SettingsController(
      { clientSettings: { version: savedVersion } } as never,
      {
        isAuthenticated: () => Promise.resolve({ isError: false, isAuthenticated: true }),
        getNodeSettings: () => Promise.resolve({ version: 'node-version' }),
        getNewContentCounts: () => Promise.resolve({ newContentCounts: {} }),
      } as never,
      {} as never,
      { assessGpus: () => Promise.resolve([]) } as never
    );
    const app = Fastify();
    app.addHook('onRequest', (request, _reply, done) => {
      request.session = { jwtToken: 'test-token' } as typeof request.session;
      done();
    });
    app.decorateReply('view', function (this: FastifyReply, _template: string, model: object) {
      return this.send(model);
    });
    app.get('/settings', controller.getSettingsPage);
    app.get('/settings/client', controller.apiGetClientSettings);
    try {
      const page = await app.inject('/settings');
      expect(page.statusCode).toBe(200);
      expect(
        page.json<{ model: { clientSettings: { version: string } } }>().model.clientSettings.version
      ).toBe(packageInfo.version);
      const api = await app.inject('/settings/client');
      expect(api.statusCode).toBe(200);
      expect(api.json<{ clientSettings: { version: string } }>().clientSettings.version).toBe(
        packageInfo.version
      );
    } finally {
      await app.close();
    }
  }
);
