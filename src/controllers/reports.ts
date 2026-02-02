import type { FastifyRequest, FastifyReply } from 'fastify';
import type { NodeApiService } from '@/services/node-api.js';

export class ReportsController {
  private readonly nodeApiService: NodeApiService;

  constructor(nodeApiService: NodeApiService) {
    this.nodeApiService = nodeApiService;
  }

  // --- Videos Reports ---

  public async getVideosRoot(request: FastifyRequest, reply: FastifyReply) {
    try {
      const jwtToken = request.session.get('jwtToken');
      const authResponse = await this.nodeApiService.isAuthenticated(jwtToken);
      
      if (authResponse.isError || !authResponse.isAuthenticated) {
          request.session.delete();
          return reply.redirect('/account/signin');
      }

      const [nodeSettings, newContentCountsResponse, videoReportsResponse, videoReportsArchiveResponse] = await Promise.all([
          this.nodeApiService.getNodeSettings(jwtToken!),
          this.nodeApiService.getNewContentCounts(jwtToken!),
          this.nodeApiService.getVideoReports(jwtToken!),
          this.nodeApiService.getVideoReportsArchive(jwtToken!)
      ]);

      const newContentCounts = newContentCountsResponse?.newContentCounts;
      const videoReports = videoReportsResponse?.reports || [];
      const videoReportsArchive = videoReportsArchiveResponse?.reports || [];

      return await reply.view('reports-videos', {
        model: {
            nodeSettings,
            newContentCounts,
            videoReports,
            videoReportsArchive
        }
      });

    } catch (error) {
       request.log.error(error);
       request.session.delete();
       return await reply.redirect('/account/signin');
    }
  }

  public async getVideosAll(request: FastifyRequest, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return await reply.send({ isError: true, message: 'Not authenticated' });
          
          const data = await this.nodeApiService.getVideoReports(jwtToken);
          return await reply.send(data);
      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }
  
  public async getCommentsArchiveAll(request: FastifyRequest, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return await reply.send({ isError: true, message: 'Not authenticated' });

          const data = await this.nodeApiService.getCommentReportsArchive(jwtToken);
          return await reply.send(data);
      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postCommentsArchive(request: FastifyRequest<{ Body: { reportId: string } }>, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return await reply.send({ isError: true, message: 'Not authenticated' });

          const { reportId } = request.body;
          const data = await this.nodeApiService.archiveCommentReport(jwtToken, reportId);
          return await reply.send(data);
      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postCommentsDelete(request: FastifyRequest<{ Body: { reportId: string } }>, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return await reply.send({ isError: true, message: 'Not authenticated' });

          const { reportId } = request.body;
          const data = await this.nodeApiService.removeCommentReport(jwtToken, reportId);
          return await reply.send(data);
      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postVideosArchiveDelete(request: FastifyRequest<{ Body: { archiveId: string } }>, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return await reply.send({ isError: true, message: 'Not authenticated' });

          const { archiveId } = request.body;
          const data = await this.nodeApiService.removeVideoReportArchive(jwtToken, archiveId);
          return await reply.send(data);
      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  // --- Comments Reports ---

  public async getCommentsRoot(request: FastifyRequest, reply: FastifyReply) {
    try {
      const jwtToken = request.session.get('jwtToken');
      const authResponse = await this.nodeApiService.isAuthenticated(jwtToken);
      
      if (authResponse.isError || !authResponse.isAuthenticated) {
          request.session.delete();
          return reply.redirect('/account/signin');
      }

      const [nodeSettings, newContentCountsResponse, commentReportsResponse, commentReportsArchiveResponse] = await Promise.all([
          this.nodeApiService.getNodeSettings(jwtToken!),
          this.nodeApiService.getNewContentCounts(jwtToken!),
          this.nodeApiService.getCommentReports(jwtToken!),
          this.nodeApiService.getCommentReportsArchive(jwtToken!)
      ]);

      const newContentCounts = newContentCountsResponse?.newContentCounts;
      const commentReports = commentReportsResponse?.reports || [];
      const commentReportsArchive = commentReportsArchiveResponse?.reports || [];

      return reply.view('reports-comments', {
        model: {
            nodeSettings,
            newContentCounts,
            commentReports,
            commentReportsArchive
        }
      });

    } catch (error) {
       request.log.error(error);
       request.session.delete();
       return reply.redirect('/account/signin');
    }
  }

  public async getCommentsAll(request: FastifyRequest, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return await reply.send({ isError: true, message: 'Not authenticated' });

          const data = await this.nodeApiService.getCommentReports(jwtToken);
          return await reply.send(data);
      } catch (error) {
          request.log.error(error);
          return await reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async getVideosArchiveAll(request: FastifyRequest, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return reply.send({ isError: true, message: 'Not authenticated' });

          const data = await this.nodeApiService.getVideoReportsArchive(jwtToken);
          return reply.send(data);
      } catch (error) {
          request.log.error(error);
          return reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postVideosArchive(request: FastifyRequest<{ Body: { reportId: string } }>, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return reply.send({ isError: true, message: 'Not authenticated' });

          const { reportId } = request.body;
          const data = await this.nodeApiService.archiveVideoReport(jwtToken, reportId);
          return reply.send(data);
      } catch (error) {
          request.log.error(error);
          return reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postVideosDelete(request: FastifyRequest<{ Body: { reportId: string } }>, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return reply.send({ isError: true, message: 'Not authenticated' });

          const { reportId } = request.body;
          const data = await this.nodeApiService.removeVideoReport(jwtToken, reportId);
          return reply.send(data);
      } catch (error) {
          request.log.error(error);
          return reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

  public async postCommentsArchiveDelete(request: FastifyRequest<{ Body: { archiveId: string } }>, reply: FastifyReply) {
      try {
          const jwtToken = request.session.get('jwtToken');
          if (!jwtToken) return reply.send({ isError: true, message: 'Not authenticated' });

          const { archiveId } = request.body;
          const data = await this.nodeApiService.removeCommentReportArchive(jwtToken, archiveId);
          return reply.send(data);
      } catch (error) {
          request.log.error(error);
          return reply.send({ isError: true, message: 'error communicating with the MoarTube node' });
      }
  }

}
