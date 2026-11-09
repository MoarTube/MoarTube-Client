import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import session from '../src/plugins/session.js';
import bundled from '../src/plugins/bundled-desktop.js';
import type { Container } from '../src/core/container.js';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
});
async function setup(
  enabled: boolean,
  loginRequired = false,
  rejected = false,
  allowRemoteConnections = false
): Promise<{ signIn: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }> {
  vi.stubEnv('MOARTUBE_BUNDLED_NODE_PORT', enabled ? '32123' : undefined);
  vi.stubEnv('MOARTUBE_DESKTOP_MODE', enabled ? 'packaged' : undefined);
  vi.stubEnv('MOARTUBE_DESKTOP_KEY', enabled ? 'private-electron-key' : undefined);
  const token = `header.${Buffer.from(JSON.stringify({ username: 'admin' })).toString('base64url')}.signature`;
  const signIn = vi
    .fn()
    .mockResolvedValue({ isAuthenticated: !rejected, token: rejected ? undefined : token });
  const connect = vi.fn();
  const container = {
    resolve: (name: string) =>
      name === 'config'
        ? { clientSettings: { bundledNodeLoginRequired: loginRequired, allowRemoteConnections } }
        : name === 'nodeApiService'
          ? { signIn }
          : { connect },
  } as unknown as Container;
  app = fastify();
  await app.register(session);
  await app.register(bundled, { container });
  app.get('/videos', (request) => ({ authenticated: Boolean(request.session.jwtToken) }));
  app.get('/account/signout', () => ({ signedOut: true }));
  app.post('/account/signin', () => ({ switched: true }));
  app.post('/settings/node/account', () => ({ changed: true }));
  app.post('/settings/node/network/internal', () => ({ changed: true }));
  app.post('/settings/node/secure', () => ({ changed: true }));
  return { signIn, connect };
}
const headers = { 'x-moartube-desktop-key': 'private-electron-key' };
describe('bundled desktop authentication scope', () => {
  it('preserves ordinary Client sign-in and sign-out without auto-authentication', async () => {
    const { signIn } = await setup(false);
    expect((await app.inject('/videos')).json()).toEqual({ authenticated: false });
    expect((await app.inject('/account/signout')).json()).toEqual({ signedOut: true });
    expect((await app.inject({ method: 'POST', url: '/account/signin' })).json()).toEqual({
      switched: true,
    });
    expect(signIn).not.toHaveBeenCalled();
  });
  it('signs in as admin once and restores admin sessions across reloads', async () => {
    const { signIn, connect } = await setup(true);
    for (let i = 0; i < 2; i++) {
      expect((await app.inject({ url: '/videos', headers })).json()).toEqual({
        authenticated: true,
      });
    }
    expect(signIn).toHaveBeenCalledExactlyOnceWith('admin', 'admin');
    expect(connect).toHaveBeenCalledOnce();
  });
  it('rejects requests outside the Electron session', async () => {
    await setup(true);
    expect((await app.inject('/videos')).statusCode).toBe(403);
    expect(
      (await app.inject({ url: '/videos', headers: { 'x-moartube-desktop-key': 'incorrect' } }))
        .statusCode
    ).toBe(403);
  });
  it('allows opted-in browser access without granting the Electron auto-admin session', async () => {
    await setup(true, false, false, true);
    expect((await app.inject('/videos')).json()).toEqual({ authenticated: false });
    expect((await app.inject({ url: '/videos', headers })).json()).toEqual({ authenticated: true });
    expect((await app.inject({ method: 'POST', url: '/account/signin' })).json()).toEqual({ switched: true });
    expect((await app.inject('/account/signout')).json()).toEqual({ signedOut: true });
    expect((await app.inject({ method: 'POST', url: '/settings/node/network/internal' })).statusCode).toBe(403);
  });
  it('preserves managed transport while allowing credential changes in bundled mode', async () => {
    await setup(true);
    for (const [method, url, status] of [
      ['GET', '/account/signout', 302],
      ['POST', '/account/signin', 302],
      ['POST', '/settings/node/account', 200],
      ['POST', '/settings/node/network/internal', 403],
      ['POST', '/settings/node/secure', 403],
    ] as const) {
      const response = await app.inject({ method, url, headers });
      expect(response.statusCode).toBe(status);
      if (status === 302) {
        expect(response.headers.location).toBe('/videos');
      }
    }
  });
  it('requires normal session authentication after credentials have been configured', async () => {
    const { signIn } = await setup(true, true);
    expect(signIn).not.toHaveBeenCalled();
    expect((await app.inject({ url: '/videos', headers })).json()).toEqual({
      authenticated: false,
    });
    expect((await app.inject({ method: 'POST', url: '/account/signin', headers })).json()).toEqual({
      switched: true,
    });
    expect((await app.inject({ url: '/account/signout', headers })).json()).toEqual({
      signedOut: true,
    });
    expect((await app.inject('/videos')).statusCode).toBe(403);
  });
  it('falls back to manual sign-in without resetting Node credentials if automatic authentication fails', async () => {
    const { signIn, connect } = await setup(true, false, true);
    expect(signIn).toHaveBeenCalledExactlyOnceWith('admin', 'admin');
    expect(connect).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/account/signin', headers })).statusCode).toBe(
      200
    );
  });
});
