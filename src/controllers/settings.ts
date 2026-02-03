import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';
import type { Config, ClientSettings } from '@/config/index.js';
import type { Logger } from '@/utils/logger.js';
import type { S3Service } from '@/services/s3.js';
import type {
    SetGpuAccelerationBody,
    SetClientEncodingBody,
    SetNodeNameBody,
    SetNodeAboutBody,
    SetNodeIdBody,
    SetSecureConnectionBody,
    SetNetworkInternalBody,
    SetNetworkExternalBody,
    SetCloudflareConfigBody,
    SetTurnstileConfigBody,
    ToggleCommentsBody,
    ToggleLikesBody,
    ToggleDislikesBody,
    ToggleReportsBody,
    ToggleLiveChatBody,
    ToggleDatabaseBody,
    ToggleStorageBody
} from '@/types/requests.js';
import { detectOperatingSystem, detectSystemCpu, detectSystemGpu } from '@/utils/hardware.js';
import sharp from 'sharp';

// Disable sharp cache
sharp.cache(false);

export class SettingsController extends BaseController {
    private readonly nodeApiService: NodeApiService;
    private readonly config: Config;
    private readonly s3Service: S3Service;

    constructor(_logger: Logger, config: Config, nodeApiService: NodeApiService, s3Service: S3Service) {
        super('settingsController');
        this.config = config;
        this.nodeApiService = nodeApiService;
        this.s3Service = s3Service;
    }

    private getClientSettings(): ClientSettings {
        return this.config.clientSettings;
    }
    
    // View: GET /settings
    public getSettingsPage = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const session = request.session;
        const jwtToken = session.jwtToken ?? '';

        if (!jwtToken) {
            return await reply.redirect('/account/signin');
        }

        const authCheck = await this.nodeApiService.isAuthenticated(jwtToken);
        if (authCheck.isError || !authCheck.isAuthenticated) {
             // Invalidate session
             session.jwtToken = '';
             session.user = undefined;
             return await reply.redirect('/account/signin');
        }

        try {
            // Get Client Settings (Local)
            const clientSettings = this.getClientSettings();
            
            // Enrich with GPU/CPU info if needed (matches legacy logic in client_GET)
            const isGpuAccelerationEnabled = clientSettings.processingAgent?.processingAgentType === 'gpu';
            const viewClientSettings = {
                ...clientSettings,
                isGpuAccelerationEnabled,
                gpuVendor: isGpuAccelerationEnabled ? clientSettings.processingAgent?.processingAgentName : undefined,
                gpuModel: isGpuAccelerationEnabled ? clientSettings.processingAgent?.processingAgentModel : undefined,
                version: this.config.clientSettings.version
            };

            // Get Node Settings (Remote)
            const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
            
            // Get New Content Counts
            const newContentCounts = (await this.nodeApiService.getNewContentCounts(jwtToken)).newContentCounts;

            return await reply.view('settings.ejs', {
                model: {
                    clientSettings: viewClientSettings,
                    nodeSettings,
                    newContentCounts
                }
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return this.sendError(reply, errorMessage);
        }
    }

    // API: GET /settings/client (Legacy: client_GET)
    public apiGetClientSettings = async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const clientSettings = this.getClientSettings();
         const isGpuAccelerationEnabled = clientSettings.processingAgent?.processingAgentType === 'gpu';

         const settings = {
            isGpuAccelerationEnabled,
            gpuVendor: isGpuAccelerationEnabled ? clientSettings.processingAgent?.processingAgentName : undefined,
            gpuModel: isGpuAccelerationEnabled ? clientSettings.processingAgent?.processingAgentModel : undefined,
            videoEncoderSettings: clientSettings.videoEncoderSettings,
            liveEncoderSettings: clientSettings.liveEncoderSettings,
            version: this.config.clientSettings.version
         };

         return reply.send({ isError: false, clientSettings: settings });
    }

    // API: POST /settings/client/gpu-acceleration
    public apiSetGpuAcceleration = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const { isGpuAccelerationEnabled } = request.body as SetGpuAccelerationBody;
         const operatingSystem = await detectOperatingSystem();
         const clientSettings = this.config.clientSettings;
         const result: { isGpuAccelerationEnabled?: boolean; gpuVendor?: string; gpuModel?: string } = {};

         if (operatingSystem === 'win32') {
             if (isGpuAccelerationEnabled) {
                 const systemGpu = await detectSystemGpu();
                 clientSettings.processingAgent = {
                    processingAgentType: 'gpu',
                    processingAgentName: systemGpu.processingAgentName,
                    processingAgentModel: systemGpu.processingAgentModel
                 };
                 result.isGpuAccelerationEnabled = true;
                 result.gpuVendor = systemGpu.processingAgentName;
                 result.gpuModel = systemGpu.processingAgentModel;
             } else {
                 const systemCpu = await detectSystemCpu();
                 clientSettings.processingAgent = {
                     processingAgentType: 'cpu',
                     processingAgentName: systemCpu.processingAgentName,
                     processingAgentModel: systemCpu.processingAgentModel
                 };
                 result.isGpuAccelerationEnabled = false;
             }

             this.config.saveClientSettings(clientSettings);
             return reply.send({ isError: false, result });
         } else {
             return reply.send({ isError: true, message: 'GPU acceleration only supported on Windows' });
         }
    }

    // API: POST /settings/client/encoding
    public apiSetClientEncoding = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { videoEncoderSettings, liveEncoderSettings } = request.body as SetClientEncodingBody;
        const clientSettings = this.config.clientSettings;
        
        clientSettings.videoEncoderSettings = videoEncoderSettings;
        clientSettings.liveEncoderSettings = liveEncoderSettings;
        
        this.config.saveClientSettings(clientSettings);
        return reply.send({ isError: false });
    }

    // API: GET /settings/client/encoding/default
    // Note: Assuming we have defaults stored or available. 
    // Legacy calls getClientSettingsDefault().
    // We should implement get defaults in Config or Repository.
    // For now, I'll return empty or current if defaults not available.

    
    // --- Node Settings Section ---

    // API: GET /settings/node
    public apiGetNodeSettings = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const session = request.session;
         const nodeSettings = await this.nodeApiService.getNodeSettings(session.jwtToken ?? '');
         return reply.send(nodeSettings);
    }

    // API: POST /settings/node/avatar
    public apiSetNodeAvatar = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const parts = request.files();
        let avatarFile: Buffer | undefined;

        for await (const part of parts) {
            if (part.fieldname === 'avatarFile') {
                 avatarFile = await part.toBuffer();
            }
        }

        if (avatarFile) {
            const iconBuffer = await sharp(avatarFile).resize({ width: 48 }).resize(48, 48).png({ compressionLevel: 9 }).toBuffer();
            const avatarBuffer = await sharp(avatarFile).resize({ width: 128 }).resize(128, 128).png({ compressionLevel: 9 }).toBuffer();
            
            const response = await this.nodeApiService.setAvatar(request.session.jwtToken ?? '', iconBuffer, avatarBuffer);
            return reply.send(response);
        }
        return reply.send({ isError: true, message: 'avatar file is missing' });
    }

    // API: POST /settings/node/banner
    public apiSetNodeBanner = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const parts = request.files();
         let bannerFile: Buffer | undefined;

         for await (const part of parts) {
             if (part.fieldname === 'bannerFile') {
                 bannerFile = await part.toBuffer();
             }
         }

         if (bannerFile) {
             const bannerBuffer = await sharp(bannerFile).resize({ width: 2560 }).resize(2560, 424).png({ compressionLevel: 9 }).toBuffer();
             const response = await this.nodeApiService.setBanner(request.session.jwtToken ?? '', bannerBuffer);
             return reply.send(response);
         }
         return reply.send({ isError: true, message: 'banner file is missing' });
    }

    // API: POST /settings/node/personalize/name
    public apiSetNodeName = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const { nodeName } = request.body as SetNodeNameBody;
         const response = await this.nodeApiService.setNodeName(request.session.jwtToken ?? '', nodeName);
         return reply.send(response);
    }
    
    // API: POST /settings/node/personalize/about
    public apiSetNodeAbout = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const { nodeAbout } = request.body as SetNodeAboutBody;
         const response = await this.nodeApiService.setNodeAbout(request.session.jwtToken ?? '', nodeAbout);
         return reply.send(response);
    }

    // API: POST /settings/node/personalize/id
    public apiSetNodeId = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const { nodeId } = request.body as SetNodeIdBody;
         const response = await this.nodeApiService.setNodeId(request.session.jwtToken ?? '', nodeId);
         return reply.send(response);
    }

    // API: POST /settings/node/network/secure
    public apiSetSecureConnection = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        // Multipart?
        let keyFile: { originalname: string; buffer: Buffer; encoding: string; mimetype: string; size: number } | undefined;
        let certFile: { originalname: string; buffer: Buffer; encoding: string; mimetype: string; size: number } | undefined;
        const caFiles: { originalname: string; buffer: Buffer; encoding: string; mimetype: string; size: number }[] = [];
        let isSecure = false;
        
        // Handling multipart with dynamic fields can be tricky if mixed with non-file fields easily.
        // Fastify multipart parses everything if we iterate.
        // We use request.parts() to iterate over both files and fields.
        
        if (!request.isMultipart()) {
             // Fallback if strictly JSON (e.g. disabling secure mode)
             const { isSecure: secure } = request.body as SetSecureConnectionBody;
             isSecure = secure;
        } else {
             // We need to buffer the files and extract fields
             for await (const part of request.parts()) {
                 if (part.type === 'file') {
                     const buf = await part.toBuffer();
                     const fileObj = { 
                         originalname: part.filename, 
                         buffer: buf, 
                         encoding: part.encoding, 
                         mimetype: part.mimetype,
                         size: buf.length 
                     }; 
                     
                     if (part.fieldname === 'keyFile') {keyFile = fileObj;}
                     else if (part.fieldname === 'certFile') {certFile = fileObj;}
                     else if (part.fieldname === 'caFiles') {caFiles.push(fileObj);}
                 } else {
                     // Field
                     if (part.fieldname === 'isSecure') {
                         isSecure = (part as { value: unknown }).value === 'true';
                     }
                 }
             }
        }
        
        const response = await this.nodeApiService.setSecureConnection(request.session.jwtToken ?? '', isSecure, keyFile, certFile, caFiles );
        
        if (!response.isError) {
             const settings = this.config.clientSettings;
             if (isSecure) {
                 settings.nodeHttpProtocol = 'https';
                 settings.nodeWebsocketProtocol = 'wss';
             } else {
                 settings.nodeHttpProtocol = 'http';
                 settings.nodeWebsocketProtocol = 'ws';
             }
             this.config.saveClientSettings(settings);
        }
        return reply.send(response);
    }

    // API: POST /settings/node/network/internal
    public apiSetNetworkInternal = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const { nodeListeningPort } = request.body as SetNetworkInternalBody;
         const response = await this.nodeApiService.setNetworkInternal(request.session.jwtToken ?? '', nodeListeningPort);
         if (!response.isError) {
             const settings = this.config.clientSettings;
             settings.nodePort = nodeListeningPort;
             this.config.saveClientSettings(settings);
         }
         return reply.send(response);
    }

    private async updateS3Manifests(jwtToken: string): Promise<void> {
        try {
            const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
            if (nodeSettings.storageConfig?.storageMode === 's3provider') {
                const { videosData } = await this.nodeApiService.getVideoDataAll(jwtToken);
                const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(jwtToken);
                
                await this.s3Service.updateM3u8ManifestsWithExternalVideosBaseUrl(nodeSettings.storageConfig.s3Config, videosData, externalVideosBaseUrl);
            }
        } catch (error) {
            this.logger.error('Failed to update S3 manifests', error as Error);
        }
    }

    // API: POST /settings/node/network/external
    public apiSetNetworkExternal = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         const { publicNodeProtocol, publicNodeAddress, publicNodePort } = request.body as SetNetworkExternalBody;
         const jwtToken = request.session.jwtToken ?? '';
         const response = await this.nodeApiService.setExternalNetwork(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort);
         
         if (!response.isError) {
              await this.updateS3Manifests(jwtToken);
         }
         return reply.send(response);
    }

    public apiSetCloudflareConfig = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey } = request.body as SetCloudflareConfigBody;
        const jwtToken = request.session.jwtToken ?? '';
        const response = await this.nodeApiService.setCloudflareConfiguration(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey);
        if (!response.isError) {
             await this.updateS3Manifests(jwtToken);
        }
        return reply.send(response);
    }
    
    public apiClearCloudflareConfig = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const jwtToken = request.session.jwtToken ?? '';
        const response = await this.nodeApiService.clearCloudflareConfiguration(jwtToken);
        if (!response.isError) {
             await this.updateS3Manifests(jwtToken);
        }
        return reply.send(response);
    }


    public apiSetTurnstileConfig = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey } = request.body as SetTurnstileConfigBody;
        const response = await this.nodeApiService.setCloudflareTurnstileConfiguration(request.session.jwtToken ?? '', cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey);
        return reply.send(response);
    }
    
    public apiClearTurnstileConfig = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const response = await this.nodeApiService.clearCloudflareTurnstileConfiguration(request.session.jwtToken ?? '');
        return reply.send(response);
    }

    public apiToggleComments = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { isCommentsEnabled } = request.body as ToggleCommentsBody;
        const response = await this.nodeApiService.commentsToggle(request.session.jwtToken ?? '', isCommentsEnabled);
        return reply.send(response);
    }
    
    public apiToggleLikes = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { isLikesEnabled } = request.body as ToggleLikesBody;
        const response = await this.nodeApiService.likesToggle(request.session.jwtToken ?? '', isLikesEnabled);
        return reply.send(response);
    }
    
    public apiToggleDislikes = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { isDislikesEnabled } = request.body as ToggleDislikesBody;
        const response = await this.nodeApiService.dislikesToggle(request.session.jwtToken ?? '', isDislikesEnabled);
        return reply.send(response);
    }

    public apiToggleReports = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { isReportsEnabled } = request.body as ToggleReportsBody;
        const response = await this.nodeApiService.reportVideosToggle(request.session.jwtToken ?? '', isReportsEnabled);
        return reply.send(response);
    }
    
    public apiToggleLiveChat = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { isLiveChatEnabled } = request.body as ToggleLiveChatBody;
        const response = await this.nodeApiService.liveChatToggle(request.session.jwtToken ?? '', isLiveChatEnabled);
        return reply.send(response);
    }
    
    public apiToggleDatabase = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { databaseConfig } = request.body as ToggleDatabaseBody;
        const response = await this.nodeApiService.databaseConfigToggle(request.session.jwtToken ?? '', databaseConfig);
        return reply.send(response);
    }
    
    public apiEmptyDatabase = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const response = await this.nodeApiService.databaseConfigEmpty(request.session.jwtToken ?? '');
        return reply.send(response);
    }
    
    public apiToggleStorage = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const { storageConfig } = request.body as ToggleStorageBody;
        const jwtToken = request.session.jwtToken ?? '';

        if (storageConfig.storageMode === 's3provider') {
            await this.s3Service.validateS3Config(storageConfig.s3Config);
        }

        const response = await this.nodeApiService.storageConfigToggle(jwtToken, storageConfig);
        
        if (!response.isError && storageConfig.storageMode === 's3provider') {
             await this.updateS3Manifests(jwtToken);
        }
        return reply.send(response);
    }
    
    public apiEmptyStorage = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const response = await this.nodeApiService.storageConfigEmpty(request.session.jwtToken ?? '');
        return reply.send(response);
    }
}

