import type { FastifyReply, FastifyRequest } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';
import type { NodeSocketService } from '@/services/node-socket.js';
import { getConfig } from '@/config/index.js';
import { z } from 'zod';

export class AccountController extends BaseController {
  constructor(
    private readonly nodeApiService: NodeApiService,
    private readonly nodeSocketService: NodeSocketService
  ) {
    super('AccountController');
  }

  getSignIn = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? ''; // Type assertion until session types are fixed
      if (jwtToken !== '') {
        const check = await this.nodeApiService.isAuthenticated(jwtToken);
        if (check.isAuthenticated) {
          return await reply.redirect('/videos');
        }
      }
      return await reply.view('signin', { model: {} });
    } catch (error) {
      this.logger.error('Error in getSignIn', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  postSignIn = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const BodySchema = z.object({
      username: z.string(),
      password: z.string(),
      moarTubeNodeIp: z.string(),
      moarTubeNodePort: z.coerce.number(), // Ensure number
    });

    try {
      const body = BodySchema.parse(request.body);
      const { moarTubeNodeIp, moarTubeNodePort } = body;

      // Heartbeat check to determine protocol
      let protocol = 'http';
      let websocketProtocol = 'ws';
      let heartbeatSuccess = false;

      try {
        this.logger.debug(
          `Attempting heartbeat checks on ${moarTubeNodeIp}:${String(moarTubeNodePort)}...`
        );
        await this.nodeApiService.heartbeat('http', moarTubeNodeIp, moarTubeNodePort);
        this.logger.debug('HTTP heartbeat successful');
        heartbeatSuccess = true;
      } catch {
        this.logger.debug('HTTP heartbeat failed, trying HTTPS...');
        try {
          await this.nodeApiService.heartbeat('https', moarTubeNodeIp, moarTubeNodePort);
          this.logger.debug('HTTPS heartbeat successful');
          protocol = 'https';
          websocketProtocol = 'wss';
          heartbeatSuccess = true;
        } catch (err) {
          this.logger.error('HTTPS heartbeat failed', err);
        }
      }

      if (!heartbeatSuccess) {
        return await this.sendError(reply, 'Could not connect to MoarTube Node');
      }

      // Update Configuration with successful connection details
      const config = getConfig();
      config.saveClientSettings({
        nodeIp: moarTubeNodeIp,
        nodePort: moarTubeNodePort,
        nodeHttpProtocol: protocol,
        nodeWebsocketProtocol: websocketProtocol,
      });

      const result = await this.nodeApiService.signIn(body.username, body.password);

      if (!result.isError && result.isAuthenticated) {
        if (result.token !== undefined && result.token !== '') {
          request.session.jwtToken = result.token;
          // connect() replaces any existing socket and cancels reconnect attempts.
          this.nodeSocketService.connect(result.token);
        }

        delete result.token;

        result.redirectUrl = '/videos';
      }

      return await reply.send(result);
    } catch (error) {
      this.logger.error('Error in postSignIn', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  getSignOut = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    await request.session.destroy();
    this.nodeSocketService.disconnect();
    return await reply.redirect('/account/signin');
  };
}
