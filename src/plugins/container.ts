import fp from 'fastify-plugin';
import { type AwilixContainer } from 'awilix';
import { type ContainerCradle } from '@/core/container.js';

// Extend FastifyRequest interface to include container
declare module 'fastify' {
  interface FastifyRequest {
    container: AwilixContainer<ContainerCradle>;
  }
}

export default fp((fastify, opts: { container: AwilixContainer<ContainerCradle> }, done) => {
  // Attach container to every request
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fastify.decorateRequest('container', null as any);
  
  fastify.addHook('onRequest', (req) => {
    req.container = opts.container;
    return Promise.resolve();
  });

  done();
});
