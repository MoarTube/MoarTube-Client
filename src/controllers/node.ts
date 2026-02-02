import type { FastifyRequest, FastifyReply } from 'fastify';
import type { NodeApiService } from '@/services/node-api.js';

export class NodeController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    this.nodeApiService = nodeApiService;
  }

  public async getSearch(request: FastifyRequest<{ Querystring: { searchTerm: string; sortTerm: string; tagTerm: string; tagLimit: number; timestamp: number } }>, reply: FastifyReply): Promise<FastifyReply> {
    try {
        const { searchTerm, sortTerm, tagTerm, tagLimit, timestamp } = request.query;
        const data = await this.nodeApiService.searchVideosAll(searchTerm, sortTerm, tagTerm, tagLimit, timestamp);
        return await reply.send(data);
    } catch (error) {
        request.log.error(error);
        return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
  }

  public async getNewContentCounts(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) {return await reply.send({ isError: true, message: 'Not authenticated' });}

          const data = await this.nodeApiService.getNewContentCounts(jwtToken);
          return await reply.send(data);
      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postContentChecked(request: FastifyRequest<{ Body: { contentType: string } }>, reply: FastifyReply): Promise<FastifyReply> {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) {return await reply.send({ isError: true, message: 'Not authenticated' });}

          const { contentType } = request.body;
          const data = await this.nodeApiService.setContentChecked(jwtToken, contentType);
          return await reply.send(data);
      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }
}
