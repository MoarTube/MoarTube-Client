import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';

export class LinksController extends BaseController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    super('LinksController');
    this.nodeApiService = nodeApiService;
  }

  // View: GET /links
  public getLinksPage = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const jwtToken = request.session.jwtToken ?? '';

    if (!jwtToken) {
      return await reply.redirect('/account/signin');
    }

    const authCheck = await this.nodeApiService.isAuthenticated(jwtToken);

    if (authCheck.isError) {
      // Log error?
      // Legacy: node_doSignout(req, res);
      await request.session.destroy();
      return await reply.redirect('/account/signin');
    }

    if (!authCheck.isAuthenticated) {
      return await reply.redirect('/account/signin');
    }

    try {
      const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
      const newContentCounts = (await this.nodeApiService.getNewContentCounts(jwtToken))
        .newContentCounts;
      const linksData = await this.nodeApiService.getLinks();
      // Legacy: links = (await linksAll_GET()).links;
      const links = linksData.links;

      return await reply.view('links.ejs', {
        model: {
          nodeSettings,
          newContentCounts,
          links,
        },
      });
    } catch (error) {
      this.logger.error('Error rendering links page', error);
      // Legacy: node_doSignout(req, res);
      await request.session.destroy();
      return await reply.redirect('/account/signin');
    }
  };

  // API: GET /links/all
  public apiGetAllLinks = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const data = await this.nodeApiService.getLinks();
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error getting all links', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  // API: POST /links/add
  public apiAddLink = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const { url, svgGraphic } = request.body as { url: string; svgGraphic: string };

      const data = await this.nodeApiService.addLink(
        request.session.jwtToken ?? '',
        url,
        svgGraphic
      );
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error adding link', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  // API: POST /links/delete
  public apiDeleteLink = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const { linkId } = request.body as { linkId: string };

      const data = await this.nodeApiService.deleteLink(request.session.jwtToken ?? '', linkId);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error deleting link', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };
}
