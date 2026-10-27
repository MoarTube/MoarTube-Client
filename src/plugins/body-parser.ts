import fp from 'fastify-plugin';
import fastifyFormBody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import { WorkPool } from '@/utils/work-pool.js';

export default fp(async (fastify) => {
  const decoders = new WorkPool(2, 0);
  const releases = new WeakMap<object, () => void>();
  fastify.addHook('onRequest', async (request, reply) => {
    if (
      request.method !== 'POST' ||
      !/\/(?:images\/(?:thumbnail|preview|poster)|avatar|banner)$/.test(
        request.url.split('?')[0] ?? ''
      )
    ) {
      return;
    }
    const release = decoders.tryAcquire();
    if (!release) {
      return reply
        .code(503)
        .header('Connection', 'close')
        .send({ isError: true, message: 'Image processing is busy; please retry shortly' });
    }
    releases.set(request, release);
    reply.raw.once('close', release);
    return;
  });
  fastify.addHook('onResponse', (request, _reply, done) => {
    releases.get(request)?.();
    releases.delete(request);
    done();
  });
  await fastify.register(fastifyFormBody);

  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 * 1024, // 10GB
    },
  });
});
