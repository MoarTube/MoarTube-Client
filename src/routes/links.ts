import type { FastifyInstance } from 'fastify';
import type { Container } from '@/core/container.js';
import { LinksController } from '@/controllers/links.js';

export function linksRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
  const logger = container.resolve('logger');
  const config = container.resolve('config');
  const nodeApiService = container.resolve('nodeApiService');

  const linksController = new LinksController(logger, config, nodeApiService);

  // View
  fastify.get('/', {
      schema: { tags: ['Links'] }
  }, linksController.getLinksPage.bind(linksController));

  // API
  fastify.get('/all', {
      schema: { tags: ['Links'] }
  }, linksController.apiGetAllLinks.bind(linksController));

  fastify.post('/add', {
      schema: { tags: ['Links'] }
  }, linksController.apiAddLink.bind(linksController));

  fastify.post('/delete', {
      schema: { tags: ['Links'] }
  }, linksController.apiDeleteLink.bind(linksController));
}
