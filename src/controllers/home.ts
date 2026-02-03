import type { FastifyReply, FastifyRequest } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';
import { getNetworkAddresses } from '@/utils/network.js';

export class HomeController extends BaseController {
    constructor(
        private readonly nodeApiService: NodeApiService
    ) {
        super('HomeController');
    }

    public getRoot = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const response = await this.nodeApiService.isAuthenticated(jwtToken);

            if (response.isError) {
                return await reply.send(response.message);
            } else if (response.isAuthenticated) {
                return await reply.redirect('/videos');
            } else {
                return await reply.redirect('/account/signin');
            }
        } catch (error) {
            this.logger.error('Error during root authentication check', error);
            // return reply.status(500).send('An error occurred while processing your request.');
            // Using sendError instead
            return await this.sendError(reply, 'An error occurred while processing your request.');
        }
    }

    public getNetwork = async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
           const addresses = getNetworkAddresses();
           return await this.sendSuccess(reply, { networkAddresses: addresses });
        } catch (error) {
            this.logger.error('Error getting network addresses', error);
            return await this.sendError(reply, 'Internal Server Error');
        }
    }
}

