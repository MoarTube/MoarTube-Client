import type { FastifyInstance } from 'fastify';
import type { Container } from '@/core/container.js';
import { MonetizationController } from '@/controllers/monetization.js';
import { z } from 'zod';

export function monetizationRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
    const nodeApiService = container.resolve('nodeApiService');
    const controller = new MonetizationController(nodeApiService);

    fastify.get('/', {
        schema: { tags: ['Monetization'] }
    }, controller.getRoot.bind(controller));

    fastify.get('/all', {
        schema: { tags: ['Monetization'] }
    }, controller.getAll.bind(controller));

    fastify.post('/add', {
        schema: {
            tags: ['Monetization'],
            body: z.object({
                walletAddress: z.string(),
                chain: z.string(),
                currency: z.string()
            })
        }
    }, controller.postAdd.bind(controller));

    fastify.post('/delete', {
        schema: {
            tags: ['Monetization'],
            body: z.object({
                cryptoWalletAddressId: z.string()
            })
        }
    }, controller.postDelete.bind(controller));
}
