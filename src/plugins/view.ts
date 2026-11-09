import fp from 'fastify-plugin';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import { getConfig } from '@/config/index.js';
import { bundledNodePort, bundledAutoLoginEnabled } from '@/config/bundled-desktop.js';

export default fp(async (fastify) => {
  const config = getConfig();

  await fastify.register(fastifyView, {
    engine: {
      ejs: ejs,
    },
    root: config.paths.views,
    viewExt: 'ejs',
    defaultContext: {
      bundledDesktop: bundledNodePort() !== undefined,
      bundledAutoLogin: bundledAutoLoginEnabled(),
    },
  });
});
