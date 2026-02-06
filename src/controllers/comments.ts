import type { FastifyRequest, FastifyReply } from 'fastify';
import type { NodeApiService } from '@/services/node-api.js';

export class CommentsController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    this.nodeApiService = nodeApiService;
  }

  public async getRoot(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      
      const authResponse = await this.nodeApiService.isAuthenticated(jwtToken);

      if (authResponse.isError || !authResponse.isAuthenticated) {
         await request.session.destroy();
         return await reply.redirect('/account/signin');
      }

      if (!jwtToken) {
          await request.session.destroy();
          return await reply.redirect('/account/signin');
      }

      const [nodeSettings, newContentCountsResponse] = await Promise.all([
          this.nodeApiService.getNodeSettings(jwtToken),
          this.nodeApiService.getNewContentCounts(jwtToken)
      ]);

      const newContentCounts = newContentCountsResponse.newContentCounts;

      // Mark comments as checked
      await this.nodeApiService.setContentChecked(jwtToken, 'comments');

      return await reply.view('comments', {
        model: {
            nodeSettings,
            newContentCounts
        }
      });

    } catch (error) {
       request.log.error(error);
       await request.session.destroy();
       return await reply.redirect('/account/signin');
    }
  }

  public async getSearch(request: FastifyRequest<{ Querystring: { videoId: string; searchTerm: string; limit: number; timestamp: number } }>, reply: FastifyReply): Promise<FastifyReply> {
     try {
         const jwtToken = request.session.jwtToken ?? '';
         if (!jwtToken) {
             return await reply.send({ isError: true, message: 'Not authenticated' });
         }

         const { videoId, searchTerm, limit, timestamp } = request.query;
         // Defaulting sortDirection to 'descending' as per legacy code
         const sortDirection = 'descending';

         const data = await this.nodeApiService.searchComments(jwtToken, videoId, searchTerm, sortDirection, limit, timestamp);
         return await reply.send(data);
     } catch (error) {
         request.log.error(error);
         return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
     }
  }

  public async getVideoId(request: FastifyRequest<{ Params: { videoId: string } }>, reply: FastifyReply): Promise<FastifyReply> {
      try {
          const jwtToken = request.session.jwtToken ?? '';
          if (!jwtToken) {
               return await reply.send({ isError: true, message: 'Not authenticated' });
          }

          const { videoId } = request.params;
          // Defaults from legacy code
          const timestamp = Date.now();
          const type = 'before';
          const sort = 'descending';

          const data = await this.nodeApiService.getVideoComments(jwtToken, videoId, timestamp, type, sort);
          return await reply.send(data);

      } catch (error) {
           request.log.error(error);
           return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postDelete(request: FastifyRequest<{ Body: { videoId: string; commentId: string; timestamp: number } }>, reply: FastifyReply): Promise<FastifyReply> {
      try {
          const jwtToken = request.session.jwtToken ?? '';
          if (!jwtToken) {
               return await reply.send({ isError: true, message: 'Not authenticated' });
          }

          const { videoId, commentId, timestamp } = request.body;
          const data = await this.nodeApiService.removeComment(jwtToken, videoId, commentId, timestamp);
          return await reply.send(data);

      } catch (error) {
           request.log.error(error);
           return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }
}
