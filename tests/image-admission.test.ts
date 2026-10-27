import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import bodyParser from '../src/plugins/body-parser.js';
describe('image decoding admission', () => {
  it('rejects excess image work before buffering the body and frees slots after responses', async () => {
    const app = Fastify();
    const release: Array<() => void> = [];
    let active = 0;
    await app.register(bodyParser);
    app.post('/settings/node/avatar', async (request) => {
      active++;
      if (!request.headers['x-immediate']) {
        await new Promise<void>((resolve) => release.push(resolve));
      }
      return { success: true };
    });
    await app.ready();
    const request = () =>
      app
        .inject({ method: 'POST', url: '/settings/node/avatar', payload: {} })
        .then((value) => value);
    const pending = [request(), request()];
    try {
      await vi.waitFor(() => {
        expect(active).toBe(2);
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/settings/node/avatar',
            headers: { 'x-immediate': 'yes' },
            payload: {},
          })
        ).statusCode
      ).toBe(503);
      release.forEach((done) => {
        done();
      });
      await Promise.all(pending);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/settings/node/avatar',
            headers: { 'x-immediate': 'yes' },
            payload: {},
          })
        ).statusCode
      ).toBe(200);
    } finally {
      release.forEach((done) => {
        done();
      });
      await Promise.all(pending);
      await app.close();
    }
  });
});
