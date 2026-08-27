import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';

export class MonetizationController extends BaseController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    super('MonetizationController');
    this.nodeApiService = nodeApiService;
  }

  public getRoot = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';

      const authResponse = await this.nodeApiService.isAuthenticated(jwtToken);

      if (authResponse.isError) {
        await request.session.destroy();
        return await reply.redirect('/account/signin');
      }

      if (!authResponse.isAuthenticated) {
        return await reply.redirect('/account/signin');
      }

      const [nodeSettings, newContentCountsResponse, monetizationResponse] = await Promise.all([
        this.nodeApiService.getNodeSettings(jwtToken),
        this.nodeApiService.getNewContentCounts(jwtToken),
        this.nodeApiService.getMonetizationAll(),
      ]);

      const newContentCounts = newContentCountsResponse.newContentCounts;
      const cryptoWalletAddresses = monetizationResponse.cryptoWalletAddresses;

      return await reply.view('monetization', {
        model: {
          nodeSettings,
          newContentCounts,
          cryptoWalletAddresses,
        },
      });
    } catch (error) {
      this.logger.error('Error in getRoot', error);
      await request.session.destroy();
      return await reply.redirect('/account/signin');
    }
  };

  public getAll = async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    try {
      const data = await this.nodeApiService.getMonetizationAll();
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getAll', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postAdd = async (
    request: FastifyRequest<{ Body: { walletAddress: string; chain: string; currency: string } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { walletAddress, chain, currency } = request.body;
      const data = await this.nodeApiService.addMonetizationAddress(
        jwtToken,
        walletAddress,
        chain,
        currency
      );
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postAdd', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postDelete = async (
    request: FastifyRequest<{ Body: { cryptoWalletAddressId: string } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { cryptoWalletAddressId } = request.body;
      const data = await this.nodeApiService.deleteMonetizationAddress(
        jwtToken,
        cryptoWalletAddressId
      );
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postDelete', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };
}
