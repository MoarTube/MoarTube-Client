/**
 * Routes Module
 *
 * Barrel export and route registration for Fastify.
 */
import type { FastifyInstance } from 'fastify';
import type { Container } from '@/core/index.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// Import for registration
import type { WebSocket } from 'ws';
import { accountRoutes } from '@/routes/account.js';
import { homeRoutes } from '@/routes/home.js';
import { videosRoutes } from '@/routes/videos.js';
import { streamsRoutes } from '@/routes/streams.js';
import { settingsRoutes } from '@/routes/settings.js';
import { linksRoutes } from '@/routes/links.js';
import { monetizationRoutes } from '@/routes/monetization.js';
import { commentsRoutes } from '@/routes/comments.js';
import { reportsRoutes } from '@/routes/reports.js';
import { nodeRoutes } from '@/routes/node.js';

/**
 * Register all application routes
 *
 * @param fastify - Fastify instance with Zod type provider
 * @param container - DI container for dependency injection
 */
export function registerRoutes(fastify: FastifyInstance, container: Container): void {
  // WebSocket Route
  fastify.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const socketService = container.resolve('socketService');
    const jwtToken = req.session.jwtToken;

    socketService.handleConnection(socket, jwtToken);
  });

  // Account routes (/account/*)
  fastify.register(
    (instance, _opts, done) => {
      accountRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/account' }
  );

  // Settings routes (/settings/*)
  fastify.register(
    (instance, _opts, done) => {
      settingsRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/settings' }
  );

  // Links routes (/links/*)
  fastify.register(
    (instance, _opts, done) => {
      linksRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/links' }
  );

  // Monetization routes (/monetization/*)
  fastify.register(
    (instance, _opts, done) => {
      monetizationRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/monetization' }
  );

  // Comments routes (/comments/*)
  fastify.register(
    (instance, _opts, done) => {
      commentsRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/comments' }
  );

  // Reports routes (/reports/*)
  // Handles /reports/videos and /reports/comments internally
  fastify.register(
    (instance, _opts, done) => {
      reportsRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/reports' }
  );

  // Node routes (/node/*)
  fastify.register(
    (instance, _opts, done) => {
      nodeRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/node' }
  );

  // Streams routes (/streams/*)
  fastify.register(
    (instance, _opts, done) => {
      streamsRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/streams' }
  );

  // Videos routes (/videos/*)
  fastify.register(
    (instance, _opts, done) => {
      videosRoutes(instance.withTypeProvider<ZodTypeProvider>(), container);
      done();
    },
    { prefix: '/videos' }
  );

  // Home routes (Root)
  // Note: Home routes are mounted at root, so no prefix or '/' prefix
  homeRoutes(fastify.withTypeProvider<ZodTypeProvider>(), container);
}
