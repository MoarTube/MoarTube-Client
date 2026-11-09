import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';
import type { Container } from '@/core/container.js';
import { bundledNodePort, setBundledAutoLogin } from '@/config/bundled-desktop.js';

export default fp<{ container: Container }>(async (app, { container }) => {
  if (bundledNodePort() === undefined) {
    return;
  }
  const key = process.env['MOARTUBE_DESKTOP_KEY'];
  if (key === undefined || key === '') {
    throw new Error('Missing desktop session key');
  }
  const sessionKey = Buffer.from(key);
  const api = container.resolve('nodeApiService');
  let token = '';
  let expiresAt = 0;
  let pending: Promise<void> | undefined;
  async function authenticate(): Promise<void> {
    const result = await api.signIn('admin', 'admin');
    if (
      result.isError ||
      !result.isAuthenticated ||
      result.token === undefined ||
      result.token === ''
    ) {
      throw new Error('Could not sign into the bundled Node');
    }
    token = result.token;
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
      exp?: number;
    };
    expiresAt = payload.exp === undefined ? Number.POSITIVE_INFINITY : payload.exp * 1000 - 60_000;
    container.resolve('nodeSocketService').connect(token);
  }
  let automaticLogin = container.resolve('config').clientSettings.bundledNodeLoginRequired !== true;
  if (automaticLogin) {
    try {
      await authenticate();
    } catch {
      // Never overwrite configured Node credentials to recover automatic login.
      // An older profile or an interrupted save can always use normal sign-in.
      automaticLogin = false;
      app.log.warn('Automatic desktop sign-in unavailable; using the sign-in screen');
    }
  }
  setBundledAutoLogin(automaticLogin);
  function isDesktopSession(supplied: unknown): boolean {
    return (
      typeof supplied === 'string' &&
      Buffer.byteLength(supplied) === sessionKey.length &&
      timingSafeEqual(Buffer.from(supplied), sessionKey)
    );
  }
  app.addHook('preHandler', async (request, reply) => {
    if (!isDesktopSession(request.headers['x-moartube-desktop-key'])) {
      // A browser on another computer must use ordinary sign-in and sign-out.
      reply.locals = { ...reply.locals, bundledAutoLogin: false };
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.routeOptions.url ?? request.url.split('?')[0];
    if (pathname === '/settings/node/network/internal' || pathname === '/settings/node/secure') {
      return reply.code(403).send({ isError: true, message: 'Managed by the desktop application' });
    }
    // Auto-admin is available only to this Electron session, including sockets.
    if (!isDesktopSession(request.headers['x-moartube-desktop-key'])) {
      if (!container.resolve('config').clientSettings.allowRemoteConnections) {
        return reply.code(403).send({ isError: true, message: 'Desktop session required' });
      }
      return;
    }
    if (automaticLogin && (pathname === '/account/signin' || pathname === '/account/signout')) {
      return reply.redirect('/videos');
    }
    if (!automaticLogin) {
      return;
    }
    if (Date.now() >= expiresAt) {
      pending ??= authenticate().finally(() => {
        pending = undefined;
      });
      await pending;
    }
    request.session.jwtToken = token;
  });
});
