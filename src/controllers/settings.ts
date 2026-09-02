import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';
import type { Config, ClientSettings } from '@/config/index.js';
import type { S3Service, S3ValidationConfig, VideoForManifestUpdate } from '@/services/s3.js';
import type { UploadedFile, StorageConfig } from '@/types/node-api.js';
import type {
  SetGpuAccelerationBody,
  SetClientEncodingBody,
  SetNodeNameBody,
  SetNodeAboutBody,
  SetNodeIdBody,
  SetNetworkInternalBody,
  SetNetworkExternalBody,
  SetAccountBody,
  SetCloudflareConfigBody,
  SetTurnstileConfigBody,
  ToggleDatabaseBody,
  ToggleStorageBody,
  ToggleBooleanBody,
} from '@/types/requests.js';
import { detectOperatingSystem, detectSystemCpu, detectSystemGpu } from '@/utils/hardware.js';
import sharp from 'sharp';
import fs from 'node:fs';

// Disable sharp cache
sharp.cache(false);

export class SettingsController extends BaseController {
  private readonly nodeApiService: NodeApiService;
  private readonly config: Config;
  private readonly s3Service: S3Service;

  constructor(config: Config, nodeApiService: NodeApiService, s3Service: S3Service) {
    super('SettingsController');
    this.config = config;
    this.nodeApiService = nodeApiService;
    this.s3Service = s3Service;
  }

  private getClientSettings(): ClientSettings {
    return this.config.clientSettings;
  }

  // View: GET /settings
  public getSettingsPage = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
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
      const isGpuAccelerationEnabled =
        clientSettings.processingAgent?.processingAgentType === 'gpu';
      const viewClientSettings = {
        ...clientSettings,
        isGpuAccelerationEnabled,
        gpuVendor: isGpuAccelerationEnabled
          ? clientSettings.processingAgent?.processingAgentName
          : undefined,
        gpuModel: isGpuAccelerationEnabled
          ? clientSettings.processingAgent?.processingAgentModel
          : undefined,
        version: this.config.clientSettings.version,
      };

      // Get Node Settings (Remote)
      const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);

      // Get New Content Counts
      const newContentCounts = (await this.nodeApiService.getNewContentCounts(jwtToken))
        .newContentCounts;

      return await reply.view('settings.ejs', {
        model: {
          clientSettings: viewClientSettings,
          nodeSettings,
          newContentCounts,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return await this.sendError(reply, errorMessage);
    }
  };

  // API: GET /settings/client (Legacy: client_GET)
  public apiGetClientSettings = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const clientSettings = this.getClientSettings();
    const isGpuAccelerationEnabled = clientSettings.processingAgent?.processingAgentType === 'gpu';

    const settings = {
      isGpuAccelerationEnabled,
      gpuVendor: isGpuAccelerationEnabled
        ? clientSettings.processingAgent?.processingAgentName
        : undefined,
      gpuModel: isGpuAccelerationEnabled
        ? clientSettings.processingAgent?.processingAgentModel
        : undefined,
      videoEncoderSettings: clientSettings.videoEncoderSettings,
      liveEncoderSettings: clientSettings.liveEncoderSettings,
      version: this.config.clientSettings.version,
    };

    return await this.sendSuccess(reply, { clientSettings: settings });
  };

  // API: POST /settings/client/gpu-acceleration
  public apiSetGpuAcceleration = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { isGpuAccelerationEnabled } = request.body as SetGpuAccelerationBody;
    const operatingSystem = detectOperatingSystem();
    const clientSettings = this.config.clientSettings;
    const result: { isGpuAccelerationEnabled?: boolean; gpuVendor?: string; gpuModel?: string } =
      {};

    if (operatingSystem === 'win32') {
      if (isGpuAccelerationEnabled) {
        const systemGpu = await detectSystemGpu();
        clientSettings.processingAgent = {
          processingAgentType: 'gpu',
          processingAgentName: systemGpu.processingAgentName,
          processingAgentModel: systemGpu.processingAgentModel,
        };
        result.isGpuAccelerationEnabled = true;
        result.gpuVendor = systemGpu.processingAgentName;
        result.gpuModel = systemGpu.processingAgentModel;
      } else {
        const systemCpu = await detectSystemCpu();
        clientSettings.processingAgent = {
          processingAgentType: 'cpu',
          processingAgentName: systemCpu.processingAgentName,
          processingAgentModel: systemCpu.processingAgentModel,
        };
        result.isGpuAccelerationEnabled = false;
      }

      this.config.saveClientSettings(clientSettings);
      return await this.sendSuccess(reply, { result });
    } else {
      return await this.sendError(reply, 'GPU acceleration only supported on Windows', 400);
    }
  };

  // API: POST /settings/client/encoding
  public apiSetClientEncoding = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { videoEncoderSettings, liveEncoderSettings } = request.body as SetClientEncodingBody;
    const clientSettings = this.config.clientSettings;

    clientSettings.videoEncoderSettings = videoEncoderSettings;
    clientSettings.liveEncoderSettings = liveEncoderSettings;

    this.config.saveClientSettings(clientSettings);
    return await this.sendSuccess(reply);
  };

  // API: GET /settings/client/encoding/default
  public apiGetClientSettingsDefault = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    try {
      const defaultSettingsPath = this.config.paths.clientSettingsDefaultPath;
      if (fs.existsSync(defaultSettingsPath)) {
        const defaults = JSON.parse(
          await fs.promises.readFile(defaultSettingsPath, 'utf-8')
        ) as ClientSettings;

        // Return just the encoding parts to match legacy expectation if helpful,
        // or the whole object. Legacy code:
        // var response = { "videoEncoderSettings": defaultSettings.videoEncoderSettings, "liveEncoderSettings": defaultSettings.liveEncoderSettings };

        const response = {
          videoEncoderSettings: defaults.videoEncoderSettings,
          liveEncoderSettings: defaults.liveEncoderSettings,
        };

        return await reply.send(response);
      }
      return await reply.send({});
    } catch (error) {
      this.logger.error('Error getting default settings', error);
      return await this.sendError(reply, 'Failed to get defaults');
    }
  };

  // --- Node Settings Section ---

  // API: GET /settings/node
  public apiGetNodeSettings = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const session = request.session;
    const nodeSettings = await this.nodeApiService.getNodeSettings(session.jwtToken ?? '');
    return await reply.send(nodeSettings);
  };

  // API: GET /settings/node/avatar
  public apiGetNodeAvatar = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const avatarBuffer = await this.nodeApiService.getAvatar(request.session.jwtToken ?? '');

    return await reply.type('image/png').send(avatarBuffer);
  };

  // API: GET /settings/node/banner
  public apiGetNodeBanner = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const bannerBuffer = await this.nodeApiService.getBanner(request.session.jwtToken ?? '');

    return await reply.type('image/png').send(bannerBuffer);
  };

  // API: POST /settings/node/avatar
  public apiSetNodeAvatar = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const parts = request.files();
    let avatarFile: Buffer | undefined;

    for await (const part of parts) {
      if (part.fieldname === 'avatar_file') {
        avatarFile = await part.toBuffer();
      }
    }

    if (avatarFile) {
      const iconBuffer = await sharp(avatarFile)
        .resize({ width: 48 })
        .resize(48, 48)
        .png({ compressionLevel: 9 })
        .toBuffer();
      const avatarBuffer = await sharp(avatarFile)
        .resize({ width: 128 })
        .resize(128, 128)
        .png({ compressionLevel: 9 })
        .toBuffer();

      const response = await this.nodeApiService.setAvatar(
        request.session.jwtToken ?? '',
        iconBuffer,
        avatarBuffer
      );
      return await reply.send(response);
    }
    return await this.sendError(reply, 'avatar file is missing', 400);
  };

  // API: POST /settings/node/banner
  public apiSetNodeBanner = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const parts = request.files();
    let bannerFile: Buffer | undefined;

    for await (const part of parts) {
      if (part.fieldname === 'banner_file') {
        bannerFile = await part.toBuffer();
      }
    }

    if (bannerFile) {
      const bannerBuffer = await sharp(bannerFile)
        .resize({ width: 2560 })
        .resize(2560, 424)
        .png({ compressionLevel: 9 })
        .toBuffer();
      const response = await this.nodeApiService.setBanner(
        request.session.jwtToken ?? '',
        bannerBuffer
      );
      return await reply.send(response);
    }
    return await this.sendError(reply, 'banner file is missing', 400);
  };

  // API: POST /settings/node/personalize/name
  public apiSetNodeName = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { nodeName } = request.body as SetNodeNameBody;
    const response = await this.nodeApiService.setNodeName(
      request.session.jwtToken ?? '',
      nodeName
    );
    return await reply.send(response);
  };

  // API: POST /settings/node/personalize/about
  public apiSetNodeAbout = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { nodeAbout } = request.body as SetNodeAboutBody;
    const response = await this.nodeApiService.setNodeAbout(
      request.session.jwtToken ?? '',
      nodeAbout
    );
    return await reply.send(response);
  };

  // API: POST /settings/node/personalize/id
  public apiSetNodeId = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { nodeId } = request.body as SetNodeIdBody;
    const response = await this.nodeApiService.setNodeId(request.session.jwtToken ?? '', nodeId);
    return await reply.send(response);
  };

  // API: POST /settings/node/secure?isSecure=true|false
  public apiSetSecureConnection = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    // isSecure comes from query string (EJS sends ?isSecure=true/false)
    const { isSecure: isSecureParam } = request.query as { isSecure: string };
    const isSecure = isSecureParam === 'true';

    let keyFile: UploadedFile | undefined;
    let certFile: UploadedFile | undefined;
    const caFiles: UploadedFile[] = [];

    if (isSecure) {
      // When enabling, extract certificate files from multipart
      if (request.isMultipart()) {
        const result = await this.processMultipartFiles(request);
        keyFile = result.keyFile;
        certFile = result.certFile;
        caFiles.push(...result.caFiles);
      }

      // Validate required files are present (matches legacy validation)
      if (!keyFile || !certFile) {
        return await this.sendError(reply, 'invalid parameters', 400);
      }
    }

    const response = await this.nodeApiService.setSecureConnection(
      request.session.jwtToken ?? '',
      isSecure,
      keyFile,
      certFile,
      caFiles.length > 0 ? caFiles : undefined
    );

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

      try {
        await this.nodeApiService.restartNode(request.session.jwtToken ?? '');
      } catch (error) {
        this.logger.error('Failed to restart node after secure connection change', error as Error);
      }
    }
    return await reply.send(response);
  };

  private async processMultipartFiles(request: FastifyRequest): Promise<{
    keyFile: UploadedFile | undefined;
    certFile: UploadedFile | undefined;
    caFiles: UploadedFile[];
  }> {
    const result = {
      keyFile: undefined as UploadedFile | undefined,
      certFile: undefined as UploadedFile | undefined,
      caFiles: [] as UploadedFile[],
    };

    for await (const part of request.parts()) {
      if (part.type !== 'file') {
        continue;
      }

      const buf = await part.toBuffer();
      const fileObj = {
        originalname: part.filename,
        buffer: buf,
        encoding: part.encoding,
        mimetype: part.mimetype,
        size: buf.length,
        filename: part.filename,
      };

      if (part.fieldname === 'keyFile') {
        result.keyFile = fileObj;
      } else if (part.fieldname === 'certFile') {
        result.certFile = fileObj;
      } else if (part.fieldname === 'caFiles') {
        result.caFiles.push(fileObj);
      }
    }
    return result;
  }

  // API: POST /settings/node/network/internal
  public apiSetNetworkInternal = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { nodeListeningPort } = request.body as SetNetworkInternalBody;
    const jwtToken = request.session.jwtToken ?? '';
    const response = await this.nodeApiService.setNetworkInternal(jwtToken, nodeListeningPort);
    if (!response.isError) {
      const settings = this.config.clientSettings;
      settings.nodePort = nodeListeningPort;
      this.config.saveClientSettings(settings);

      try {
        await this.nodeApiService.restartNode(jwtToken);
      } catch (error) {
        this.logger.error('Failed to restart node after network internal change', error as Error);
      }
    }
    return await reply.send(response);
  };

  private async updateS3Manifests(jwtToken: string): Promise<void> {
    try {
      const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
      if (
        nodeSettings.storageConfig?.storageMode === 's3provider' &&
        nodeSettings.storageConfig.s3Config
      ) {
        const { videosData } = await this.nodeApiService.getVideoDataAll(jwtToken);
        const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(jwtToken);

        // s3Config from Node already has nested shape: { bucketName, s3ProviderClientConfig }
        const s3ValidationConfig = nodeSettings.storageConfig
          .s3Config as unknown as S3ValidationConfig;

        const videosForUpdate = videosData as VideoForManifestUpdate[];
        await this.s3Service.updateM3u8ManifestsWithExternalVideosBaseUrl(
          s3ValidationConfig,
          videosForUpdate,
          externalVideosBaseUrl
        );
      }
    } catch (error) {
      this.logger.error('Failed to update S3 manifests', error as Error);
    }
  }

  // API: POST /settings/node/network/external
  public apiSetNetworkExternal = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { publicNodeProtocol, publicNodeAddress, publicNodePort } =
      request.body as SetNetworkExternalBody;
    const jwtToken = request.session.jwtToken ?? '';
    const response = await this.nodeApiService.setExternalNetwork(
      jwtToken,
      publicNodeProtocol,
      publicNodeAddress,
      publicNodePort
    );

    if (!response.isError) {
      await this.updateS3Manifests(jwtToken);
    }
    return await reply.send(response);
  };

  public apiSetCloudflareConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey } =
      request.body as SetCloudflareConfigBody;
    const jwtToken = request.session.jwtToken ?? '';
    const response = await this.nodeApiService.setCloudflareConfiguration(
      jwtToken,
      cloudflareEmailAddress,
      cloudflareZoneId,
      cloudflareGlobalApiKey
    );
    if (!response.isError) {
      await this.updateS3Manifests(jwtToken);
    }
    return await reply.send(response);
  };

  public apiClearCloudflareConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const jwtToken = request.session.jwtToken ?? '';
    const response = await this.nodeApiService.clearCloudflareConfiguration(jwtToken);
    if (!response.isError) {
      await this.updateS3Manifests(jwtToken);
    }
    return await reply.send(response);
  };

  public apiSetTurnstileConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey } =
      request.body as SetTurnstileConfigBody;
    const response = await this.nodeApiService.setCloudflareTurnstileConfiguration(
      request.session.jwtToken ?? '',
      cloudflareTurnstileSiteKey,
      cloudflareTurnstileSecretKey
    );
    return await reply.send(response);
  };

  public apiClearTurnstileConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const response = await this.nodeApiService.clearCloudflareTurnstileConfiguration(
      request.session.jwtToken ?? ''
    );
    return await reply.send(response);
  };

  public apiToggleComments = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { isEnabled } = request.body as ToggleBooleanBody;
    const response = await this.nodeApiService.commentsToggle(
      request.session.jwtToken ?? '',
      isEnabled
    );
    return await reply.send(response);
  };

  public apiToggleLikes = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { isEnabled } = request.body as ToggleBooleanBody;
    const response = await this.nodeApiService.likesToggle(
      request.session.jwtToken ?? '',
      isEnabled
    );
    return await reply.send(response);
  };

  public apiToggleDislikes = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { isEnabled } = request.body as ToggleBooleanBody;
    const response = await this.nodeApiService.dislikesToggle(
      request.session.jwtToken ?? '',
      isEnabled
    );
    return await reply.send(response);
  };

  public apiToggleReports = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { isEnabled } = request.body as ToggleBooleanBody;
    const response = await this.nodeApiService.reportVideosToggle(
      request.session.jwtToken ?? '',
      isEnabled
    );
    return await reply.send(response);
  };

  public apiToggleLiveChat = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { isEnabled } = request.body as ToggleBooleanBody;
    const response = await this.nodeApiService.liveChatToggle(
      request.session.jwtToken ?? '',
      isEnabled
    );
    return await reply.send(response);
  };

  public apiToggleDatabase = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { databaseConfig } = request.body as ToggleDatabaseBody;
    const jwtToken = request.session.jwtToken ?? '';
    const response = await this.nodeApiService.databaseConfigToggle(jwtToken, databaseConfig);

    if (!response.isError) {
      try {
        await this.nodeApiService.restartNode(jwtToken);
      } catch (error) {
        this.logger.error('Failed to restart node after database toggle', error as Error);
      }
    }

    return await reply.send(response);
  };

  public apiToggleStorage = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { storageConfig } = request.body as ToggleStorageBody;
    const jwtToken = request.session.jwtToken ?? '';

    let s3ValidationConfig: S3ValidationConfig | undefined;

    if (storageConfig.storageMode === 's3provider') {
      s3ValidationConfig = storageConfig.s3Config as unknown as S3ValidationConfig;
      await this.s3Service.validateS3Config(s3ValidationConfig);
    }

    const videosData = (await this.nodeApiService.getVideoDataAll(jwtToken))['videosData'];

    const validStorageConfig = storageConfig as StorageConfig;
    const response = await this.nodeApiService.storageConfigToggle(jwtToken, validStorageConfig);

    if (!response.isError && storageConfig.storageMode === 's3provider' && s3ValidationConfig) {
      try {
        const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(jwtToken);
        const videosForUpdate = videosData as VideoForManifestUpdate[];
        await this.s3Service.updateM3u8ManifestsWithExternalVideosBaseUrl(
          s3ValidationConfig,
          videosForUpdate,
          externalVideosBaseUrl
        );
      } catch (error) {
        this.logger.error('Failed to update S3 manifests after storage toggle', error as Error);
      }
    }

    if (!response.isError) {
      try {
        await this.nodeApiService.restartNode(jwtToken);
      } catch (error) {
        this.logger.error('Failed to restart node after storage toggle', error as Error);
      }
    }

    return await reply.send(response);
  };

  public apiSetAccountCredentials = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { username, password } = request.body as SetAccountBody;
    const jwtToken = request.session.jwtToken ?? '';
    const response = await this.nodeApiService.setAccountCredentials(jwtToken, username, password);
    return await reply.send(response);
  };

  public apiImportDatabase = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const jwtToken = request.session.jwtToken ?? '';
    const parts = request.files();
    let databaseFile: Buffer | undefined;

    for await (const part of parts) {
      if (part.fieldname === 'database_file') {
        databaseFile = await part.toBuffer();
        break;
      }
    }

    if (databaseFile) {
      const response = await this.nodeApiService.settingsImportDatabase(jwtToken, databaseFile);
      return await reply.send(response);
    } else {
      return await this.sendError(reply, 'database file is missing', 400);
    }
  };

  public apiExportDatabase = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const jwtToken = request.session.jwtToken ?? '';
    const response = (await this.nodeApiService.settingsExportDatabase(jwtToken)) as {
      isError: boolean;
      database: unknown;
      message?: string;
    };

    if (response.isError) {
      return await reply.status(500).send(response);
    } else {
      const databaseJsonString = JSON.stringify(response.database);
      reply.header(
        'Content-Disposition',
        `attachment; filename=database-${String(Date.now())}.json`
      );
      reply.header('Content-Type', 'application/json');
      return await reply.send(databaseJsonString);
    }
  };
}
