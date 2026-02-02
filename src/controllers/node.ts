import type { FastifyRequest, FastifyReply } from 'fastify';
import type { NodeApiService } from '@/services/node-api.js';

export class NodeController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    this.nodeApiService = nodeApiService;
  }

  public async getSearch(request: FastifyRequest<{ Querystring: { searchTerm: string; sortTerm: string; tagTerm: string; tagLimit: number; timestamp: number } }>, reply: FastifyReply) {
    try {
        const { searchTerm, sortTerm, tagTerm, tagLimit, timestamp } = request.query;
        const data = await this.nodeApiService.searchVideosAll(searchTerm, sortTerm, tagTerm, tagLimit, timestamp);
        return reply.send(data);
    } catch (error) {
        request.log.error(error);
        return reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
  }

  public async getNewContentCounts(request: FastifyRequest, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return reply.send({ isError: true, message: 'Not authenticated' });

          const data = await this.nodeApiService.getNewContentCounts(jwtToken);
          return reply.send(data);
      } catch (error) {
          request.log.error(error);
          return reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postContentChecked(request: FastifyRequest<{ Body: { contentType: string } }>, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return reply.send({ isError: true, message: 'Not authenticated' });

          const { contentType } = request.body;
          const data = await this.nodeApiService.setContentChecked(jwtToken, contentType);
          return reply.send(data);
      } catch (error) {
          request.log.error(error);
          return reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }
}
