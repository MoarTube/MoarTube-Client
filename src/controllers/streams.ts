import { requireNodeSuccess } from '@/utils/node-actions.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { LiveStreamService } from '@/services/live-stream.js';
import type { NodeApiService } from '@/services/node-api.js';
import { checkNetworkPortStatus, isPortValid } from '@/utils/network.js';
import type { NodeSocketService } from '@/services/node-socket.js';
import type {
  StartStreamBody,
  StopStreamParams,
  VideoIdParams,
  UpdateChatSettingsBody,
} from '@/types/requests.js';

export class StreamsController extends BaseController {
  private readonly liveStreamService: LiveStreamService;
  private readonly nodeApiService: NodeApiService;
  private readonly nodeSocketService: NodeSocketService;

  constructor(
    liveStreamService: LiveStreamService,
    nodeApiService: NodeApiService,
    nodeSocketService: NodeSocketService
  ) {
    super('StreamsController');
    this.liveStreamService = liveStreamService;
    this.nodeApiService = nodeApiService;
    this.nodeSocketService = nodeSocketService;
  }

  public startStream = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const body = request.body as StartStreamBody;
    const {
      title,
      description,
      tags,
      rtmpPort,
      resolution,
      isRecordingStreamRemotely,
      isRecordingStreamLocally,
      networkAddress,
      videoId: existingVideoId,
    } = body;

    if (!isPortValid(rtmpPort)) {
      return await this.sendError(reply, 'rtmpPort is not valid', 400);
    }

    let admitted: string | undefined;
    try {
      const portStatus = await checkNetworkPortStatus(Number.parseInt(rtmpPort, 10), '127.0.0.1');

      if (portStatus === 'closed') {
        const uuid = 'moartube';
        const jwtToken = request.session.jwtToken ?? '';

        const response = await this.nodeApiService.streamVideo(jwtToken, {
          title,
          description,
          tags,
          rtmpPort: Number.parseInt(rtmpPort, 10),
          uuid,
          resolution,
          isRecordingStreamRemotely,
          isRecordingStreamLocally,
          networkAddress,
          ...(existingVideoId !== undefined && existingVideoId !== ''
            ? { videoId: existingVideoId }
            : {}),
        });

        if (response.isError) {
          return await reply.send(response);
        }

        const newVideoId = response.videoId;
        admitted = newVideoId;

        const setExtResponse = requireNodeSuccess(
          await this.nodeApiService.setSourceFileExtension(jwtToken, newVideoId, '.ts')
        );

        if (setExtResponse.isError) {
          return await reply.send(setExtResponse);
        }

        const rtmpUrl = `rtmp://${networkAddress}:${rtmpPort}/live/${uuid}`;

        await this.liveStreamService.performStreamingJob(
          jwtToken,
          newVideoId,
          rtmpUrl,
          'm3u8',
          resolution,
          isRecordingStreamRemotely,
          isRecordingStreamLocally
        );

        return await this.sendSuccess(reply, { rtmpUrl });
      } else {
        return await this.sendError(reply, `port ${rtmpPort} is not available`, 400);
      }
    } catch (error) {
      if (admitted !== undefined) {
        try {
          await this.nodeApiService.stopVideoStreaming(request.session.jwtToken ?? '', admitted);
        } catch (cleanupError) {
          this.logger.error('Stream startup cleanup remains pending', cleanupError as Error);
        }
      }
      this.logger.error('Error starting stream', error as Error);
      return await this.sendError(reply, (error as Error).message || 'Unknown error');
    }
  };

  public stopStream = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const params = request.params as StopStreamParams;
    const { videoId } = params;
    const jwtToken = request.session.jwtToken ?? '';

    try {
      const drainSeconds = await this.liveStreamService.stopLiveStream(videoId);
      this.nodeSocketService.sendVideoStatusEcho(jwtToken, 'streaming_stopping', videoId);

      const stopResponse = await this.nodeApiService.stopVideoStreaming(
        jwtToken,
        videoId,
        drainSeconds
      );

      if (!stopResponse.isError) {
        // Broadcast streaming_stopped to Node (Node will echo back to all clients)
        this.nodeSocketService.sendVideoStatusEcho(jwtToken, 'streaming_stopped', videoId);
      }

      return await reply.send(stopResponse);
    } catch (error) {
      this.logger.error('Error stopping stream', error as Error);
      return await this.sendError(reply, (error as Error).message || 'Unknown error');
    }
  };

  public getStreamRtmpInfo = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const params = request.params as VideoIdParams;
    const { videoId } = params;
    const jwtToken = request.session.jwtToken ?? '';

    try {
      const response = await this.nodeApiService.getVideoData(jwtToken, videoId);
      if (response.isError) {
        return await reply.send(response);
      }

      const meta = response.videoData.meta;
      const networkAddress = meta?.networkAddress;
      const rtmpPort = meta?.rtmpPort;
      const uuid = meta?.uuid;

      const rtmpStreamUrl = `rtmp://${String(networkAddress)}:${String(rtmpPort)}/live/${String(uuid)}`;
      const rtmpServerUrl = `rtmp://${String(networkAddress)}:${String(rtmpPort)}/live`;
      const rtmpStreamkey = uuid;

      return await this.sendSuccess(reply, { rtmpStreamUrl, rtmpServerUrl, rtmpStreamkey });
    } catch (error) {
      this.logger.error('Error getting stream RTMP info', error as Error);
      return await this.sendError(reply, (error as Error).message);
    }
  };

  public getChatSettings = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const params = request.params as VideoIdParams;
    const { videoId } = params;
    const jwtToken = request.session.jwtToken ?? '';

    try {
      const response = await this.nodeApiService.getVideoData(jwtToken, videoId);
      if (response.isError) {
        return await reply.send(response);
      }
      const meta = response.videoData.meta;
      return await this.sendSuccess(reply, {
        isChatHistoryEnabled: meta?.chatSettings.isChatHistoryEnabled ?? false,
        chatHistoryLimit: meta?.chatSettings.chatHistoryLimit ?? 0,
      });
    } catch (error) {
      this.logger.error('Error getting chat settings', error as Error);
      return await this.sendError(reply, (error as Error).message);
    }
  };

  public updateChatSettings = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const params = request.params as VideoIdParams;
    const { videoId } = params;
    const body = request.body as UpdateChatSettingsBody;
    const { isChatHistoryEnabled, chatHistoryLimit } = body;
    const jwtToken = request.session.jwtToken ?? '';

    try {
      const response = await this.nodeApiService.setVideoChatSettings(
        jwtToken,
        videoId,
        isChatHistoryEnabled,
        chatHistoryLimit
      );
      return await reply.send(response);
    } catch (error) {
      this.logger.error('Error updating chat settings', error as Error);
      return await this.sendError(reply, (error as Error).message);
    }
  };
}
