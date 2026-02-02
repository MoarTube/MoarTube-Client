import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import { LiveStreamService } from '@/services/live-stream.js';
import { NodeApiService } from '@/services/node-api.js';
import { checkNetworkPortStatus, isPortValid } from '@/utils/network.js';
import { S3Service } from '@/services/s3.js';

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

    public async startStream(request: FastifyRequest, reply: FastifyReply) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const body = request.body as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { title, description, tags, rtmpPort, resolution, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, videoId: existingVideoId } = body;

        if (!isPortValid(rtmpPort)) {
            return reply.send({ isError: true, message: 'rtmpPort is not valid' });
        }

        try {
            // Check if port is available
            const portStatus = await checkNetworkPortStatus(parseInt(rtmpPort as string, 10), '127.0.0.1');

            if (portStatus === 'closed') {
                const uuid = 'moartube';
                
                // Get JWT token from request or session
                // Assuming request is authenticated and has user/token? 
                // Or maybe passed in body? Legacy passes jwtToken as first arg to start_POST.
                // In Fastify, usually handled by middleware, but if NodeAPI needs it, we extract it.
                // Assuming bearer token in header.
                const authHeader = request.headers.authorization;
                const jwtToken = authHeader?.replace('Bearer ', '') || '';

                if (!jwtToken) {
                    return reply.code(401).send({ isError: true, message: 'Unauthorized' });
                }

                const response = await this.nodeApiService.streamVideo(
                    jwtToken,
                    title as string, description as string, tags as string, resolution as string,
                    isRecordingStreamRemotely as boolean, isRecordingStreamLocally as boolean,
                    networkAddress as string, existingVideoId as string
                );

                if (response.isError) {
                     return reply.send(response);
                }

                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                const newVideoId = response.videoId; 

                // Construct RTMP URL
                const rtmpUrl = `rtmp://0.0.0.0:${rtmpPort}/live/${uuid}`;
                const format = 'm3u8';

                await this.liveStreamService.performStreamingJob(
                    jwtToken,
                    newVideoId as string,
                    rtmpUrl,
                    format,
                    resolution as string,
                    isRecordingStreamRemotely as boolean,
                    isRecordingStreamLocally as boolean
                );
                
                // LiveStreamService tracks the process internally by videoId
                
                return reply.send({ isError: false, videoId: newVideoId });
            } else {
                 return reply.send({ isError: true, message: 'RTMP port is already in use' });
            }

        } catch (error: any) {
            this.logger.error('Error starting stream', error);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            return reply.send({ isError: true, message: error.message || 'Unknown error' });
        }
    }
    
    public async stopStream(request: FastifyRequest, reply: FastifyReply) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const params = request.params as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { videoId } = params;
        
        const authHeader = request.headers.authorization;
        const jwtToken = authHeader?.replace('Bearer ', '') || '';
        
        if (!jwtToken) {
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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const storageConfig = nodeSettings.storageConfig;

            if (storageConfig.storageMode === 's3provider') {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const s3Config = storageConfig.s3Config;

                const videoDataResponse = await this.nodeApiService.getVideoData(jwtToken, videoId as string);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const videoData = videoDataResponse.videoData;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const isStreamRecordedRemotely = videoData.isStreamRecordedRemotely;

                if (isStreamRecordedRemotely) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const resolutions = videoData.outputs.m3u8;
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    await this.s3Service.convertM3u8DynamicManifestsToStatic(s3Config, videoId as string, resolutions);
                } else {
                    const prefix = `external/videos/${videoId}/adaptive/m3u8`;
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    await this.s3Service.deleteDirectoryRecursive(s3Config, prefix);
                }
            }
            
            this.liveStreamService.stopLiveStream(videoId as string); // managed in service

            const stopResponse = await this.nodeApiService.stopVideoStreaming(jwtToken, videoId as string);
            
            return reply.send(stopResponse);
        } catch (error: any) {
            this.logger.error('Error stopping stream', error);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            return reply.send({ isError: true, message: error.message || 'Unknown error' });
        }
    }

    public async getStreamRtmpInfo(request: FastifyRequest, reply: FastifyReply) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const params = request.params as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { videoId } = params;
        const authHeader = request.headers.authorization;
        const jwtToken = authHeader?.replace('Bearer ', '') || '';
        if (!jwtToken) return reply.code(401).send({ isError: true, message: 'Unauthorized' });

        try {
            const response = await this.nodeApiService.getVideoData(jwtToken, videoId as string);
            if (response.isError) {
                return reply.send(response);
            }
            
            const meta = response.videoData.meta;
            const networkAddress = meta.networkAddress;
            const rtmpPort = meta.rtmpPort;
            const uuid = meta.uuid;

            const rtmpStreamUrl = `rtmp://${networkAddress}:${rtmpPort}/live/${uuid}`;
            const rtmpServerUrl = `rtmp://${networkAddress}:${rtmpPort}/live`;
            const rtmpStreamkey = uuid;
            
            return reply.send({ isError: false, rtmpStreamUrl, rtmpServerUrl, rtmpStreamkey });
        } catch (error: any) {
            this.logger.error('Error getting stream RTMP info', error);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            return reply.send({ isError: true, message: error.message });
        }
    }
    
    public async getChatSettings(request: FastifyRequest, reply: FastifyReply) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const params = request.params as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { videoId } = params;
        const authHeader = request.headers.authorization;
        const jwtToken = authHeader?.replace('Bearer ', '') || '';
        if (!jwtToken) return reply.code(401).send({ isError: true, message: 'Unauthorized' });

        try {
            const response = await this.nodeApiService.getVideoData(jwtToken, videoId as string);
             if (response.isError) {
                return reply.send(response);
            }
            const meta = response.videoData.meta;
            return reply.send({ 
                isError: false, 
                isChatHistoryEnabled: meta.chatSettings.isChatHistoryEnabled,
                chatHistoryLimit: meta.chatSettings.chatHistoryLimit 
            });
        } catch (error: any) {
            this.logger.error('Error getting chat settings', error);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            return reply.send({ isError: true, message: error.message });
        }
    }

    public async updateChatSettings(request: FastifyRequest, reply: FastifyReply) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const params = request.params as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { videoId } = params;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const body = request.body as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { isChatHistoryEnabled, chatHistoryLimit } = body;
        
        const authHeader = request.headers.authorization;
        const jwtToken = authHeader?.replace('Bearer ', '') || '';
        if (!jwtToken) return reply.code(401).send({ isError: true, message: 'Unauthorized' });

        try {
            const response = await this.nodeApiService.setVideoChatSettings(jwtToken, videoId as string, isChatHistoryEnabled as boolean, chatHistoryLimit as number);
            return reply.send(response);
        } catch (error: any) {
            this.logger.error('Error updating chat settings', error);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            return reply.send({ isError: true, message: error.message });
        }
    }
}
