import fastify, { FastifyInstance } from 'fastify';
import path from 'node:path';

// Plugins
import fastifyCors from '@fastify/cors';
import fastifyFormBody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fastifyWebsocket from '@fastify/websocket';
import ejs from 'ejs';
import crypto from 'node:crypto';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// DI
import { type AwilixContainer } from 'awilix';
import { type ContainerCradle } from '@/core/container.js';
// import { fastifyAwilixPlugin, diContainer } from '@fastify/awilix'; 

// Config
import { getConfig } from '@/config/index.js';

export async function createFastifyApp(container: AwilixContainer<ContainerCradle>): Promise<FastifyInstance> {
  const config = getConfig();

  const app = fastify({
    logger: false, // We use our own logger
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Attach container to every request
  app.decorateRequest('container', null as any);
  app.addHook('onRequest', async (req) => {
    req.container = container; 
  });

  // Register Plugins
  await app.register(fastifyCors, { 
      origin: true 
  });
  
  await app.register(fastifyFormBody);
  
  await app.register(fastifyMultipart, {
      limits: {
          fileSize: 10 * 1024 * 1024 * 1024, // 10GB
      }
  });

  await app.register(fastifyCookie);
  await app.register(fastifySession, {
      secret: crypto.randomBytes(32).toString('hex'),
      cookie: { secure: false }, // Set to true if using HTTPS
      saveUninitialized: true
  });

  await app.register(fastifyWebsocket);

  // Static Files
  const publicPath = config.paths.public;
  
  await app.register(fastifyStatic, {
    root: path.join(publicPath, 'javascript'),
    prefix: '/javascript/',
    decorateReply: false
  });
  
  await app.register(fastifyStatic, {
      root: path.join(publicPath, 'css'),
      prefix: '/css/',
      decorateReply: false
  });
    
  await app.register(fastifyStatic, {
      root: path.join(publicPath, 'images'),
      prefix: '/images/',
      decorateReply: false
  });

   await app.register(fastifyStatic, {
      root: path.join(publicPath, 'fonts'),
      prefix: '/fonts/',
      decorateReply: false
  });

  // View Engine (EJS)
  await app.register(fastifyView, {
    engine: {
      ejs: ejs,
    },
    root: config.paths.views,
    viewExt: 'ejs',
    defaultContext: {
        // Global variables available in views
    }
  });

  // Session Management (TODO in Phase 1)
  
  // Routes are registered in moartube-client.ts, unlike Node where it's done inside createFastifyApp. 
  // We will keep it that way for now to minimize changes to moartube-client.ts logic, but ideally we move it here.
  // The user only asked to move the file, not refactor the flow entirely.
  // Wait, I see "app.get('/', ...)" in original app.ts. I should remove that if routes are registered externally.
  // Looking at moartube-client.ts: "registerRoutes(app, container);" is called AFTER createApp.
  // So the "app.get('/', ...)" in app.ts might be test code or legacy.
  // I will keep the test route for now if it was there, or removing it if registerRoutes covers it.
  // The original app.ts had:
  //   // Routes (TODO in Phase 3)
  //   app.get('/', async (req, reply) => {
  //       return { hello: 'world' };
  //   });
  // I will include it for parity with the moved file.

  // app.get('/', async (_req, _reply) => {
  //     return { hello: 'world' };
  // });

  return app;
}

// Augment Fastify Request to include container
declare module 'fastify' {
  interface FastifyRequest {
    container: AwilixContainer<ContainerCradle>;
    session: any; // Placeholder until session plugin installed
  }
}
