/**
 * Videos Routes
 */
import type { FastifyInstance } from 'fastify';
import { VideosController } from '@/controllers/index.js';
import type { Container } from '@/core/index.js';

export function videosRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
    const nodeApiService = container.resolve('nodeApiService');
    const videoImportService = container.resolve('videoImportService');
    const videoPublishService = container.resolve('videoPublishService');
    const settingsRepository = container.resolve('settingsRepository');
    const manifestService = container.resolve('manifestService');
    const s3Service = container.resolve('s3Service');
    const socketService = container.resolve('socketService');

    const controller = new VideosController(
        nodeApiService,
        videoImportService,
        videoPublishService,
        settingsRepository,
        manifestService,
        s3Service,
        socketService
    );

    fastify.get('/', {
        schema: { tags: ['Videos'] }
    }, controller.getRoot.bind(controller));
    
    fastify.get('/search', {
        schema: { tags: ['Videos'] }
    }, controller.getSearch.bind(controller));

    fastify.post('/import', {
        schema: { tags: ['Videos'] }
    }, controller.postImport.bind(controller));

    fastify.post('/:videoId/importing/stop', {
        schema: { tags: ['Videos'] }
    }, controller.postStopImport.bind(controller));

    fastify.post('/:videoId/publish', {
        schema: { tags: ['Videos'] }
    }, controller.postPublish.bind(controller));

    fastify.post('/:videoId/publishing/stop', {
        schema: { tags: ['Videos'] }
    }, controller.postStopPublish.bind(controller));
    
    fastify.post('/:videoId/unpublish', {
        schema: { tags: ['Videos'] }
    }, controller.postUnpublish.bind(controller));

    fastify.get('/tags', {
        schema: { tags: ['Videos'] }
    }, controller.getTags.bind(controller));

    fastify.get('/tags/all', {
        schema: { tags: ['Videos'] }
    }, controller.getAllTags.bind(controller));

    fastify.get('/:videoId/publishes', {
        schema: { tags: ['Videos'] }
    }, controller.getVideoPublishes.bind(controller));

    fastify.get('/:videoId/data', {
        schema: { tags: ['Videos'] }
    }, controller.getVideoData.bind(controller));

    fastify.post('/:videoId/data', {
        schema: { tags: ['Videos'] }
    }, controller.postVideoData.bind(controller));

    fastify.post('/delete', {
        schema: { tags: ['Videos'] }
    }, controller.postDelete.bind(controller));

    fastify.post('/finalize', {
        schema: { tags: ['Videos'] }
    }, controller.postFinalize.bind(controller));

    fastify.post('/:videoId/index/add', {
        schema: { tags: ['Videos'] }
    }, controller.postAddToIndex.bind(controller));

    fastify.post('/:videoId/index/remove', {
        schema: { tags: ['Videos'] }
    }, controller.postRemoveFromIndex.bind(controller));

    fastify.post('/:videoId/images/thumbnail', {
        schema: { tags: ['Videos'] }
    }, controller.postThumbnail.bind(controller));

    fastify.post('/:videoId/images/preview', {
        schema: { tags: ['Videos'] }
    }, controller.postPreview.bind(controller));

    fastify.post('/:videoId/images/poster', {
        schema: { tags: ['Videos'] }
    }, controller.postPoster.bind(controller));

    fastify.get('/:videoId/permissions', {
        schema: { tags: ['Videos'] }
    }, controller.getVideoPermissions.bind(controller));

    fastify.post('/:videoId/permissions', {
        schema: { tags: ['Videos'] }
    }, controller.postVideoPermissions.bind(controller));

    fastify.get('/:videoId/sources', {
        schema: { tags: ['Videos'] }
    }, controller.getVideoSources.bind(controller));
}
