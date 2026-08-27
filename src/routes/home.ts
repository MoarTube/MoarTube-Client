/**
 * Home Routes
 */
import type { FastifyInstance } from 'fastify';
import { HomeController } from '@/controllers/home.js';
import type { Container } from '@/core/index.js';

export function homeRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
  const nodeApiService = container.resolve('nodeApiService');
  const controller = new HomeController(nodeApiService);

  fastify.get(
    '/',
    {
      schema: { tags: ['Home'] },
    },
    controller.getRoot.bind(controller)
  );

  fastify.get(
    '/network',
    {
      schema: { tags: ['Home'] },
    },
    controller.getNetwork.bind(controller)
  );
}
