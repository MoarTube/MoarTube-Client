import type { FastifyInstance } from 'fastify';
import type { Container } from '@/core/container.js';
import { CommentsController } from '@/controllers/comments.js';
import { z } from 'zod';

export function commentsRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
    const nodeApiService = container.resolve('nodeApiService');
    const controller = new CommentsController(nodeApiService);

    fastify.get('/', {
        schema: { tags: ['Comments'] }
    }, controller.getRoot.bind(controller));

    fastify.get('/search', {
        schema: {
            tags: ['Comments'],
            querystring: z.object({
                videoId: z.string().optional(),
                searchTerm: z.string().optional(),
                limit: z.coerce.number().optional().default(10), // Default? Legacy doesn't specify, but coercion is good
                timestamp: z.coerce.number().optional()
            })
        }
    }, controller.getSearch.bind(controller));

    fastify.get('/:videoId', {
        schema: {
            tags: ['Comments'],
            params: z.object({
                videoId: z.string()
            })
        }
    }, controller.getVideoId.bind(controller));

    fastify.post('/delete', {
        schema: {
            tags: ['Comments'],
            body: z.object({
                videoId: z.string(),
                commentId: z.string(),
                timestamp: z.coerce.number().optional()
            })
        }
    }, controller.postDelete.bind(controller));
}
