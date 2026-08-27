import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';

export class NodeController extends BaseController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    super('NodeController');
    this.nodeApiService = nodeApiService;
  }

  public getSearch = async (
    request: FastifyRequest<{
      Querystring: {
        searchTerm: string;
        sortTerm: string;
        tagTerm: string;
        tagLimit: number;
        timestamp: number;
      };
    }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const { searchTerm, sortTerm, tagTerm, tagLimit, timestamp } = request.query;
      const data = await this.nodeApiService.searchVideosAll(
        searchTerm,
        sortTerm,
        tagTerm,
        tagLimit,
        timestamp
      );
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getSearch', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public getNewContentCounts = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const data = await this.nodeApiService.getNewContentCounts(jwtToken);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getNewContentCounts', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postContentChecked = async (
    request: FastifyRequest<{ Body: { contentType: string } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { contentType } = request.body;
      const data = await this.nodeApiService.setContentChecked(jwtToken, contentType);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postContentChecked', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };
}
