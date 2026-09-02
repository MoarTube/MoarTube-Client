// Imports from specific plugin files
import containerPlugin from '@/plugins/container.js';
import corsPlugin from '@/plugins/cors.js';
import bodyParserPlugin from '@/plugins/body-parser.js';
import sessionPlugin from '@/plugins/session.js';
import websocketPlugin from '@/plugins/websocket.js';
import staticPlugin from '@/plugins/static.js';
import viewPlugin from '@/plugins/view.js';
import swaggerPlugin from '@/plugins/swagger.js';

import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerRoutes } from '@/routes/index.js';

// DI
import { type AwilixContainer } from 'awilix';
import { type ContainerCradle } from '@/core/container.js';

export async function createFastifyApp(
  container: AwilixContainer<ContainerCradle>
): Promise<FastifyInstance> {
  const app = fastify({
    logger: false, // We use our own logger
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register Container
  await app.register(containerPlugin, { container });

  // Register Plugins
  await app.register(corsPlugin);
  await app.register(bodyParserPlugin);
  await app.register(sessionPlugin, { container });
  await app.register(websocketPlugin);
  await app.register(staticPlugin);
  await app.register(viewPlugin);
  await app.register(swaggerPlugin);

  // Register Routes
  registerRoutes(app, container);

  return app;
}
