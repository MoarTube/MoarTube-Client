import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { LiveStreamService } from '@/services/live-stream.js';
import type { NodeApiService } from '@/services/node-api.js';
import { checkNetworkPortStatus, isPortValid } from '@/utils/network.js';
import type { S3Service } from '@/services/s3.js';
import type {
    StartStreamBody,
    StopStreamParams,
    VideoIdParams,
    UpdateChatSettingsBody
} from '@/types/requests.js';

export class StreamsController extends BaseController {
    private liveStreamService: LiveStreamService;
    private nodeApiService: NodeApiService;
    private s3Service: S3Service;

    constructor(
        liveStreamService: LiveStreamService,
        nodeApiService: NodeApiService,
        s3Service: S3Service
    ) {
        super('streamsController');
        this.liveStreamService = liveStreamService;
        this.nodeApiService = nodeApiService;
        this.s3Service = s3Service;
    }

    public async startStream(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
        const body = request.body as StartStreamBody;
        const { title, description, tags, rtmpPort, resolution, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, videoId: existingVideoId } = body;

        if (!isPortValid(rtmpPort)) {
            return reply.send({ isError: true, message: 'rtmpPort is not valid' });
        }

        try {
            // Check if port is available
            const portStatus = await checkNetworkPortStatus(parseInt(rtmpPort, 10), '127.0.0.1');

            if (portStatus === 'closed') {
                const uuid = 'moartube';
                
                // Get JWT token from request or session
                // Assuming request is authenticated and has user/token? 
                // Or maybe passed in body? Legacy passes jwtToken as first arg to start_POST.
                // In Fastify, usually handled by middleware, but if NodeAPI needs it, we extract it.
                // Assuming bearer token in header.
                const authHeader = request.headers.authorization;
                const jwtToken = authHeader?.replace('Bearer ', '') ?? '';

                if (jwtToken === '') {
                    return await reply.code(401).send({ isError: true, message: 'Unauthorized' });
                }

                const response = await this.nodeApiService.streamVideo(
                    jwtToken,
                    title, description, tags, resolution,
                    isRecordingStreamRemotely, isRecordingStreamLocally,
                    networkAddress, existingVideoId
                );

                if (response.isError) {
                     return await reply.send(response);
                }

                const newVideoId = response.videoId; 

                // Construct RTMP URL
                const rtmpUrl = `rtmp://0.0.0.0:${rtmpPort}/live/${uuid}`;
                const format = 'm3u8';

                await this.liveStreamService.performStreamingJob(
                    jwtToken,
                    newVideoId,
                    rtmpUrl,
                    format,
                    resolution,
                    isRecordingStreamRemotely,
                    isRecordingStreamLocally
                );
                
                // LiveStreamService tracks the process internally by videoId
                
                return await reply.send({ isError: false, videoId: newVideoId });
            } else {
                 return await reply.send({ isError: true, message: 'RTMP port is already in use' });
            }

        } catch (error) {
            this.logger.error('Error starting stream', error as Error);
            return await reply.send({ isError: true, message: (error as Error).message || 'Unknown error' });
        }
    }
    
    public async stopStream(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
        const params = request.params as StopStreamParams;
        const { videoId } = params;
        
        const authHeader = request.headers.authorization;
        const jwtToken = authHeader?.replace('Bearer ', '') ?? '';
        
        if (jwtToken === '') {
             return reply.code(401).send({ isError: true, message: 'Unauthorized' });
        }

        try {
            // Stop process via service
            // Note: LiveStreamService manages via videoId.
            // But legacy tracker managed via 'moartube' (uuid).
            // If strictly following legacy, we kill 'moartube' process.
            // If LiveStreamService keyed by videoId, we use videoId.
            // In startStream above: `this.addProcessToLiveStreamTracker(videoId, process)` (in LiveStreamService)
            // So LiveStreamService uses videoId.
            // I should use videoId.
            
            // Also notify WebSocket? `websocketClientBroadcast`
            // Should be in `LiveStreamService` or Controller.
            // Controller is better for response-related logic.
            
            // S3 Conversion Logic
            const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
            const storageConfig = nodeSettings.storageConfig;

            if (storageConfig?.storageMode === 's3provider' && storageConfig.s3Config) {
                const s3Config = storageConfig.s3Config;

                const videoDataResponse = await this.nodeApiService.getVideoData(jwtToken, videoId);
                const videoData = videoDataResponse.videoData;
                const isStreamRecordedRemotely = videoData.isStreamRecordedRemotely;

                if (isStreamRecordedRemotely === true) {
                    const resolutions = videoData.outputs.m3u8;
                    await this.s3Service.convertM3u8DynamicManifestsToStatic(s3Config, videoId, resolutions);
                } else {
                    const prefix = `external/videos/${videoId}/adaptive/m3u8`;
                     
                    await this.s3Service.deleteDirectoryRecursive(s3Config, prefix);
                }
            }
            
            this.liveStreamService.stopLiveStream(videoId); // managed in service

            const stopResponse = await this.nodeApiService.stopVideoStreaming(jwtToken, videoId);
            
            return await reply.send(stopResponse);
        } catch (error) {
            this.logger.error('Error stopping stream', error as Error);
            return await reply.send({ isError: true, message: (error as Error).message || 'Unknown error' });
        }
    }

    public async getStreamRtmpInfo(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
        const params = request.params as VideoIdParams;
        const { videoId } = params;
        const authHeader = request.headers.authorization;
        const jwtToken = authHeader?.replace('Bearer ', '') ?? '';
        if (jwtToken === '') {return reply.code(401).send({ isError: true, message: 'Unauthorized' });}

        try {
            const response = await this.nodeApiService.getVideoData(jwtToken, videoId);
            if (response.isError) {
                return await reply.send(response);
            }
            
            const meta = response.videoData.meta;
            const networkAddress = meta.networkAddress;
            const rtmpPort = meta.rtmpPort;
            const uuid = meta.uuid;

            const rtmpStreamUrl = `rtmp://${networkAddress}:${String(rtmpPort)}/live/${uuid}`;
            const rtmpServerUrl = `rtmp://${networkAddress}:${String(rtmpPort)}/live`;
            const rtmpStreamkey = uuid;
            
            return await reply.send({ isError: false, rtmpStreamUrl, rtmpServerUrl, rtmpStreamkey });
        } catch (error) {
            this.logger.error('Error getting stream RTMP info', error as Error);
            return await reply.send({ isError: true, message: (error as Error).message });
        }
    }
    
    public async getChatSettings(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
        const params = request.params as VideoIdParams;
        const { videoId } = params;
        const authHeader = request.headers.authorization;
        const jwtToken = authHeader?.replace('Bearer ', '') ?? '';
        if (jwtToken === '') {return reply.code(401).send({ isError: true, message: 'Unauthorized' });}

        try {
            const response = await this.nodeApiService.getVideoData(jwtToken, videoId);
             if (response.isError) {
                return await reply.send(response);
            }
            const meta = response.videoData.meta;
            return await reply.send({ 
                isError: false, 
                isChatHistoryEnabled: meta.chatSettings.isChatHistoryEnabled,
                chatHistoryLimit: meta.chatSettings.chatHistoryLimit 
            });
        } catch (error) {
            this.logger.error('Error getting chat settings', error as Error);
            return await reply.send({ isError: true, message: (error as Error).message });
        }
    }

    public async updateChatSettings(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
        const params = request.params as VideoIdParams;
        const { videoId } = params;
        const body = request.body as UpdateChatSettingsBody;
        const { isChatHistoryEnabled, chatHistoryLimit } = body;
        
        const authHeader = request.headers.authorization;
        const jwtToken = authHeader?.replace('Bearer ', '') ?? '';
        if (jwtToken === '') {return reply.code(401).send({ isError: true, message: 'Unauthorized' });}

        try {
            const response = await this.nodeApiService.setVideoChatSettings(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error updating chat settings', error as Error);
            return await reply.send({ isError: true, message: (error as Error).message });
        }
    }
}
