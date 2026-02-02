/**
 * Account Routes
 *
 * Routes for authentication and account management.
 */
import type { FastifyInstance } from 'fastify';
import { AccountController } from '@/controllers/index.js';
import { signInBodySchema } from '@/validators/index.js';
import type { Container } from '@/core/index.js';

/**
 * Register account routes
 *
 * @param fastify - Fastify instance with Zod type provider
 * @param container - DI container
 */
export function accountRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
  const nodeApiService = container.resolve('nodeApiService');
  const nodeSocketService = container.resolve('nodeSocketService');
  // const config = container.resolve('config');

  const controller = new AccountController(nodeApiService, nodeSocketService);
  
  // Sign in - public endpoint
  fastify.post(
    '/signin',
    {
      schema: {
        tags: ['Account'],
        body: signInBodySchema,
      },
    },
    controller.postSignIn.bind(controller)
  );

    // Sign out - public endpoint (client just discards token)
  fastify.get(
    '/signout',
    {
      schema: {
        tags: ['Account'],
      },
    },
    controller.getSignOut.bind(controller)
  );

    // Sign in View
    // Legacy: GET /signin
    fastify.get(
        '/signin',
        {
            schema: {
                tags: ['Account']
            }
        },
        controller.getSignIn.bind(controller)
    );
}
