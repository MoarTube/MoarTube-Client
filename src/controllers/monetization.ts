import type { FastifyRequest, FastifyReply } from 'fastify';
import type { NodeApiService } from '@/services/node-api.js';

export class MonetizationController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    this.nodeApiService = nodeApiService;
  }

  public async getRoot(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    try {
      const jwtToken = request.session.get('jwtToken');
      // Authenticated check is usually handled by a hook/decorator in the new architecture if applied globally?
      // But here we might need to do it manually or rely on a preHandler.
      // The legacy code does manual check.
      // Let's assume we do manual check for now to match legacy logic 1:1, or improve it.
      
      const authResponse = await this.nodeApiService.isAuthenticated(jwtToken);

      if (authResponse.isError) {
        // In legacy: log message and signout.
        // request.session.delete(); // clear session
        // return reply.redirect('/account/signin');
        // Let's standardise on redirecting if not authenticated.
         request.session.delete();
         return await reply.redirect('/account/signin');
      }

      if (!authResponse.isAuthenticated) {
        return await reply.redirect('/account/signin');
      }

      const [nodeSettings, newContentCountsResponse, monetizationResponse] = await Promise.all([
          this.nodeApiService.getNodeSettings(jwtToken!),
          this.nodeApiService.getNewContentCounts(jwtToken!),
          this.nodeApiService.getMonetizationAll()
      ]);

      const newContentCounts = newContentCountsResponse?.newContentCounts;
      const cryptoWalletAddresses = monetizationResponse?.cryptoWalletAddresses || [];

      return await reply.view('monetization', {
        model: {
            nodeSettings,
            newContentCounts,
            cryptoWalletAddresses
        }
      });

    } catch (error) {
       request.log.error(error);
       request.session.delete();
       return await reply.redirect('/account/signin');
    }
  }

  public async getAll(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
     try {
         const data = await this.nodeApiService.getMonetizationAll();
         return await reply.send(data);
     } catch (error) {
         request.log.error(error);
         return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
     }
  }

  public async postAdd(request: FastifyRequest<{ Body: { walletAddress: string; chain: string; currency: string } }>, reply: FastifyReply): Promise<FastifyReply> {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) {
              return await reply.send({ isError: true, message: 'Not authenticated' });
          }

          const { walletAddress, chain, currency } = request.body;
          const data = await this.nodeApiService.addMonetizationAddress(jwtToken, walletAddress, chain, currency);
          return await reply.send(data);

      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postDelete(request: FastifyRequest<{ Body: { cryptoWalletAddressId: string } }>, reply: FastifyReply): Promise<FastifyReply> {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) {
               return await reply.send({ isError: true, message: 'Not authenticated' });
          }

          const { cryptoWalletAddressId } = request.body;
          const data = await this.nodeApiService.deleteMonetizationAddress(jwtToken, cryptoWalletAddressId);
          return await reply.send(data);

      } catch (error) {
           request.log.error(error);
           return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }
}
