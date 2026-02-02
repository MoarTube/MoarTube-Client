import type { FastifyInstance } from 'fastify';
import type { Container } from '@/core/container.js';
import { NodeController } from '@/controllers/node.js';
import { z } from 'zod';

export function nodeRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
    const nodeApiService = container.resolve('nodeApiService');
    const controller = new NodeController(nodeApiService);

    fastify.get('/search', {
        schema: {
            tags: ['Node'],
            querystring: z.object({
                searchTerm: z.string().optional(),
                sortTerm: z.string().optional(),
                tagTerm: z.string().optional(),
                tagLimit: z.coerce.number().optional(),
                timestamp: z.coerce.number().optional()
            })
        }
    }, controller.getSearch.bind(controller));

    fastify.get('/newContentCounts', {
        schema: { tags: ['Node'] }
    }, controller.getNewContentCounts.bind(controller));

    fastify.post('/contentChecked', {
        schema: {
            tags: ['Node'],
            body: z.object({
                contentType: z.string()
            })
        }
    }, controller.postContentChecked.bind(controller));
}
