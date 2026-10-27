import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';

function pageNumber(value: unknown): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 0 && page <= 10_000_000 ? page : 0;
}
function pages(request: FastifyRequest) {
  const query = (request.query ?? {}) as {
    page?: string;
    archivePage?: string;
    search?: string;
    offset?: string;
  };
  return {
    reportPage: pageNumber(query.page),
    archivePage: pageNumber(query.archivePage),
    search: (query.search ?? '').slice(0, 100),
  };
}
export class ReportsController extends BaseController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    super('ReportsController');
    this.nodeApiService = nodeApiService;
  }

  // --- Videos Reports ---

  public getVideosRoot = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      const pagination = pages(request);
      const authResponse = await this.nodeApiService.isAuthenticated(jwtToken);

      if (authResponse.isError || !authResponse.isAuthenticated) {
        await request.session.destroy();
        return await reply.redirect('/account/signin');
      }

      if (!jwtToken) {
        await request.session.destroy();
        return await reply.redirect('/account/signin');
      }

      const [
        nodeSettings,
        newContentCountsResponse,
        videoReportsResponse,
        videoReportsArchiveResponse,
      ] = await Promise.all([
        this.nodeApiService.getNodeSettings(jwtToken),
        this.nodeApiService.getNewContentCounts(jwtToken),
        this.nodeApiService.getVideoReports(jwtToken, {
          offset: pagination.reportPage * 100,
          search: pagination.search,
        }),
        this.nodeApiService.getVideoReportsArchive(jwtToken, {
          offset: pagination.archivePage * 100,
          search: pagination.search,
        }),
      ]);

      const newContentCounts = newContentCountsResponse.newContentCounts;
      const videoReports = videoReportsResponse.reports;
      const videoReportsArchive = videoReportsArchiveResponse.reports;

      // Mark video reports as checked
      await this.nodeApiService.setContentChecked(jwtToken, 'videoReports');

      return await reply.view('reports-videos', {
        model: {
          ...pagination,
          reportHasMore: videoReportsResponse.hasMore ?? false,
          archiveHasMore: videoReportsArchiveResponse.hasMore ?? false,
          nodeSettings,
          newContentCounts,
          videoReports,
          videoReportsArchive,
        },
      });
    } catch (error) {
      this.logger.error('Error in getVideosRoot', error);
      await request.session.destroy();
      return await reply.redirect('/account/signin');
    }
  };

  public getVideosAll = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const data = await this.nodeApiService.getVideoReports(jwtToken, {
        offset: pageNumber((request.query as { offset?: string } | undefined)?.offset),
        search: pages(request).search,
      });
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getVideosAll', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public getCommentsArchiveAll = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const data = await this.nodeApiService.getCommentReportsArchive(jwtToken, {
        offset: pageNumber((request.query as { offset?: string } | undefined)?.offset),
        search: pages(request).search,
      });
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getCommentsArchiveAll', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postCommentsArchive = async (
    request: FastifyRequest<{ Body: { reportId: number } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { reportId } = request.body;
      const data = await this.nodeApiService.archiveCommentReport(jwtToken, reportId);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postCommentsArchive', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postCommentsDelete = async (
    request: FastifyRequest<{ Body: { reportId: number } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { reportId } = request.body;
      const data = await this.nodeApiService.removeCommentReport(jwtToken, reportId);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postCommentsDelete', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postVideosArchiveDelete = async (
    request: FastifyRequest<{ Body: { archiveId: number } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { archiveId } = request.body;
      const data = await this.nodeApiService.removeVideoReportArchive(jwtToken, archiveId);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postVideosArchiveDelete', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  // --- Comments Reports ---

  public getCommentsRoot = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      const pagination = pages(request);
      const authResponse = await this.nodeApiService.isAuthenticated(jwtToken);

      if (authResponse.isError || !authResponse.isAuthenticated) {
        await request.session.destroy();
        return await reply.redirect('/account/signin');
      }

      if (!jwtToken) {
        await request.session.destroy();
        return await reply.redirect('/account/signin');
      }

      const [
        nodeSettings,
        newContentCountsResponse,
        commentReportsResponse,
        commentReportsArchiveResponse,
      ] = await Promise.all([
        this.nodeApiService.getNodeSettings(jwtToken),
        this.nodeApiService.getNewContentCounts(jwtToken),
        this.nodeApiService.getCommentReports(jwtToken, {
          offset: pagination.reportPage * 100,
          search: pagination.search,
        }),
        this.nodeApiService.getCommentReportsArchive(jwtToken, {
          offset: pagination.archivePage * 100,
          search: pagination.search,
        }),
      ]);

      const newContentCounts = newContentCountsResponse.newContentCounts;
      const commentReports = commentReportsResponse.reports;
      const commentReportsArchive = commentReportsArchiveResponse.reports;

      // Mark comment reports as checked
      await this.nodeApiService.setContentChecked(jwtToken, 'commentReports');

      return await reply.view('reports-comments', {
        model: {
          ...pagination,
          reportHasMore: commentReportsResponse.hasMore ?? false,
          archiveHasMore: commentReportsArchiveResponse.hasMore ?? false,
          nodeSettings,
          newContentCounts,
          commentReports,
          commentReportsArchive,
        },
      });
    } catch (error) {
      this.logger.error('Error in getCommentsRoot', error);
      await request.session.destroy();
      return await reply.redirect('/account/signin');
    }
  };

  public getCommentsAll = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const data = await this.nodeApiService.getCommentReports(jwtToken, {
        offset: pageNumber((request.query as { offset?: string } | undefined)?.offset),
        search: pages(request).search,
      });
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getCommentsAll', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public getVideosArchiveAll = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const data = await this.nodeApiService.getVideoReportsArchive(jwtToken, {
        offset: pageNumber((request.query as { offset?: string } | undefined)?.offset),
        search: pages(request).search,
      });
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in getVideosArchiveAll', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postVideosArchive = async (
    request: FastifyRequest<{ Body: { reportId: number } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { reportId } = request.body;
      const data = await this.nodeApiService.archiveVideoReport(jwtToken, reportId);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postVideosArchive', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postVideosDelete = async (
    request: FastifyRequest<{ Body: { reportId: number } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { reportId } = request.body;
      const data = await this.nodeApiService.removeVideoReport(jwtToken, reportId);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postVideosDelete', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };

  public postCommentsArchiveDelete = async (
    request: FastifyRequest<{ Body: { archiveId: number } }>,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (!jwtToken) {
        return await this.sendError(reply, 'Not authenticated', 401);
      }

      const { archiveId } = request.body;
      const data = await this.nodeApiService.removeCommentReportArchive(jwtToken, archiveId);
      return await reply.send(data);
    } catch (error) {
      this.logger.error('Error in postCommentsArchiveDelete', error);
      return await this.sendError(reply, 'error communicating with the MoarTube node');
    }
  };
}
