import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { getConfig } from '@/config/index.js';

export default fp(async (fastify) => {
  const config = getConfig();
  const publicPath = config.paths.public;

  await fastify.register(fastifyStatic, {
    root: path.join(publicPath, 'javascript'),
    prefix: '/javascript/',
    decorateReply: false
  });
  
  await fastify.register(fastifyStatic, {
      root: path.join(publicPath, 'css'),
      prefix: '/css/',
      decorateReply: false
  });
    
  await fastify.register(fastifyStatic, {
      root: path.join(publicPath, 'images'),
      prefix: '/images/',
      decorateReply: false
  });

   await fastify.register(fastifyStatic, {
      root: path.join(publicPath, 'fonts'),
      prefix: '/fonts/',
      decorateReply: false
  });
});
