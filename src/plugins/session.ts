import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import crypto from 'node:crypto';

export default fp(async (fastify) => {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifySession, {
      secret: crypto.randomBytes(32).toString('hex'),
      cookie: { secure: false }, // Set to true if using HTTPS
      saveUninitialized: true
  });
});
