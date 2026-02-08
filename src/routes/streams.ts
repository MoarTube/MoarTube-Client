import type { FastifyInstance } from 'fastify';
import { StreamsController } from '@/controllers/streams.js';
import type { Container } from '@/core/container.js';

export function streamsRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
    const liveStreamService = container.resolve('liveStreamService');
    const nodeApiService = container.resolve('nodeApiService');
    const s3Service = container.resolve('s3Service');
    const nodeSocketService = container.resolve('nodeSocketService');

    const streamsController = new StreamsController(
        liveStreamService,
        nodeApiService,
        s3Service,
        nodeSocketService
    );

    fastify.post('/start', {
        schema: { tags: ['Streams'] }
    }, streamsController.startStream.bind(streamsController));

    fastify.post('/:videoId/stop', {
        schema: { tags: ['Streams'] }
    }, streamsController.stopStream.bind(streamsController));
    
    fastify.get('/:videoId/rtmp/information', {
        schema: { tags: ['Streams'] }
    }, streamsController.getStreamRtmpInfo.bind(streamsController));

    fastify.get('/:videoId/chat/settings', {
        schema: { tags: ['Streams'] }
    }, streamsController.getChatSettings.bind(streamsController));

    fastify.post('/:videoId/chat/settings', {
        schema: { tags: ['Streams'] }
    }, streamsController.updateChatSettings.bind(streamsController));
}
