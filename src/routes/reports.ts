import type { FastifyInstance } from 'fastify';
import type { Container } from '@/core/container.js';
import { ReportsController } from '@/controllers/reports.js';
import { z } from 'zod';

export function reportsRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
    const nodeApiService = container.resolve('nodeApiService');
    const controller = new ReportsController(nodeApiService);

    // --- Videos Routes ---

    fastify.get('/videos', {
        schema: { tags: ['Reports'] }
    }, controller.getVideosRoot.bind(controller));

    fastify.get('/videos/all', {
        schema: { tags: ['Reports'] }
    }, controller.getVideosAll.bind(controller));

    fastify.get('/videos/archive/all', {
        schema: { tags: ['Reports'] }
    }, controller.getVideosArchiveAll.bind(controller));

    fastify.post('/videos/archive', {
        schema: {
            tags: ['Reports'],
            body: z.object({
                reportId: z.string()
            })
        }
    }, controller.postVideosArchive.bind(controller));

    fastify.post('/videos/delete', {
        schema: {
            tags: ['Reports'],
            body: z.object({
                reportId: z.string()
            })
        }
    }, controller.postVideosDelete.bind(controller));

    fastify.post('/videos/archive/delete', {
        schema: {
            tags: ['Reports'],
            body: z.object({
                archiveId: z.string()
            })
        }
    }, controller.postVideosArchiveDelete.bind(controller));


    // --- Comments Routes ---

    fastify.get('/comments', {
        schema: { tags: ['Reports'] }
    }, controller.getCommentsRoot.bind(controller));

    fastify.get('/comments/all', {
        schema: { tags: ['Reports'] }
    }, controller.getCommentsAll.bind(controller));

    fastify.get('/comments/archive/all', {
        schema: { tags: ['Reports'] }
    }, controller.getCommentsArchiveAll.bind(controller));

    fastify.post('/comments/archive', {
        schema: {
            tags: ['Reports'],
            body: z.object({
                reportId: z.string()
            })
        }
    }, controller.postCommentsArchive.bind(controller));

    fastify.post('/comments/delete', {
        schema: {
            tags: ['Reports'],
            body: z.object({
                reportId: z.string()
            })
        }
    }, controller.postCommentsDelete.bind(controller));

    fastify.post('/comments/archive/delete', {
        schema: {
            tags: ['Reports'],
            body: z.object({
                archiveId: z.string()
            })
        }
    }, controller.postCommentsArchiveDelete.bind(controller));

}
