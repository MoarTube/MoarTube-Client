import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';

export default fp(async (fastify) => {
  await fastify.register(fastifyWebsocket, { options: { maxPayload: 256 * 1024 } });
});
