import fp from 'fastify-plugin';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import { getConfig } from '@/config/index.js';

export default fp(async (fastify) => {
  const config = getConfig();

  await fastify.register(fastifyView, {
    engine: {
      ejs: ejs,
    },
    root: config.paths.views,
    viewExt: 'ejs',
    defaultContext: {
        // Global variables available in views
    }
  });
});
