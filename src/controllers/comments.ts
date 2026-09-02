import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';

export class CommentsController extends BaseController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    super('CommentsController');
    this.nodeApiService = nodeApiService;
  }

  public getRoot = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';

      const authResponse = await this.nodeApiService.isAuthenticated(jwtToken);

      if (authResponse.isError || !authResponse.isAuthenticated) {
        await request.session.destroy();
        return await reply.redirect('/account/signin');
      }

      const [nodeSettings, newContentCountsResponse] = await Promise.all([
        this.nodeApiService.getNodeSettings(jwtToken),
        this.nodeApiService.getNewContentCounts(jwtToken),
      ]);

      const newContentCounts = newContentCountsResponse.newContentCounts;

      // Mark comments as checked
      await this.nodeApiService.setContentChecked(jwtToken, 'comments');

      return await reply.view('comments', {
        model: {
          nodeSettings,
          newContentCounts,
        },
      });
    } catch (error) {
      this.logger.error('Error in getRoot', error);
      await request.session.destroy();
      return await reply.redirect('/account/signin');
    }
  };

  public getSearch = async (
    request: FastifyRequest<{
      Querystring: { videoId: string; searchTerm: string; limit: number; timestamp: number };
    }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { videoId, searchTerm, limit, timestamp } = request.query;
      // Defaulting sortDirection to 'descending' as per legacy code
      const sortDirection = 'descending';

      const data = await this.nodeApiService.searchComments(
        jwtToken,
        videoId,
        searchTerm,
        sortDirection,
        limit,
        timestamp
      );
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getSearch', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public getVideoId = async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { videoId } = request.params;
      // Defaults from legacy code
      const timestamp = Date.now();
      const type = 'before';
      const sort = 'descending';

      const data = await this.nodeApiService.getVideoComments(
        jwtToken,
        videoId,
        timestamp,
        type,
        sort
      );
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getVideoId', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postDelete = async (
    request: FastifyRequest<{ Body: { videoId: string; commentId: string; timestamp: number } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { videoId, commentId, timestamp } = request.body;
      const data = await this.nodeApiService.removeComment(jwtToken, videoId, commentId, timestamp);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postDelete', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };
}
