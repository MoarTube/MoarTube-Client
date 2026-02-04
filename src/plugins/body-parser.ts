import fp from 'fastify-plugin';
import fastifyFormBody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';

export default fp(async (fastify) => {
  await fastify.register(fastifyFormBody);
  
  await fastify.register(fastifyMultipart, {
      limits: {
          fileSize: 10 * 1024 * 1024 * 1024, // 10GB
      }
  });
});
