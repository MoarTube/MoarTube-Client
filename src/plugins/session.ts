import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import crypto from 'node:crypto';
import { ExpiringSessionStore } from '@/utils/session-store.js';

export default fp(async (fastify) => {
  const store = new ExpiringSessionStore();
  fastify.addHook('onClose', (_instance, done) => {
    store.close();
    done();
  });
  await fastify.register(fastifyCookie);
  await fastify.register(fastifySession, {
    secret: crypto.randomBytes(32).toString('hex'),
    store,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
    saveUninitialized: false,
  });
});
