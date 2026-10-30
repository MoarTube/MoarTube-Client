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
  SetNetworkInternalBody,
  SetNetworkExternalBody,
  SetAccountBody,
  SetCloudflareConfigBody,
  SetTurnstileConfigBody,
  ToggleDatabaseBody,
  ToggleStorageBody,
  ToggleBooleanBody,
} from '@/types/requests.js';
import { detectSystemCpu } from '@/utils/hardware.js';
import sharp from 'sharp';
import type { FfmpegService, GpuCapability } from '@/services/ffmpeg.js';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeUpload } from '@/utils/stream-files.js';
import { getStorageMetrics, type StorageMetrics } from '@/utils/storage-metrics.js';
import { CLIENT_VERSION } from '@/utils/version.js';

// Disable sharp cache
sharp.cache(false);

export class SettingsController extends BaseController {
  private metricsScan: Promise<StorageMetrics> | undefined;

  public apiGetMetrics = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (jwtToken === '') {
        return await this.sendError(reply, 'Sign in to view metrics', 401);
      }
      const auth = await this.nodeApiService.isAuthenticated(jwtToken);
      if (auth.isError || !auth.isAuthenticated) {
        return await this.sendError(reply, 'Sign in to view metrics', 401);
      }
      const { target } = request.params as { target: string };
      if (target === 'node') {
        const settings = await this.nodeApiService.getNodeSettings(jwtToken);
        const metrics: StorageMetrics =
          settings.storageConfig?.storageMode === 's3provider'
            ? {
                storageMode: 's3provider',
                mediaBytes: null,
                availableBytes: null,
                totalBytes: null,
              }
            : await this.nodeApiService.getStorageMetrics(jwtToken);
        return await this.sendSuccess(reply, { metrics });
      }
      if (target !== 'client') {
        return await this.sendError(reply, 'Unknown metrics target', 404);
      }
      this.metricsScan ??= getStorageMetrics(path.join(this.config.paths.data, 'media')).finally(
        () => {
          this.metricsScan = undefined;
        }
      );
      return await this.sendSuccess(reply, { metrics: await this.metricsScan });
    } catch (error) {
      this.logger.error('Failed to load storage metrics', error);
      return await this.sendError(reply, 'Unable to load storage metrics');
    }
  };

  private readonly nodeApiService: NodeApiService;
  private readonly config: Config;
  private readonly s3Service: S3Service;

  constructor(
    config: Config,
    nodeApiService: NodeApiService,
    s3Service: S3Service,
    private readonly ffmpegService: FfmpegService
  ) {
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

      const viewClientSettings = {
        ...clientSettings,
        ...(await this.getGpuSettings()),
        version: CLIENT_VERSION,
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
    const settings = {
      ...(await this.getGpuSettings()),
      videoEncoderSettings: clientSettings.videoEncoderSettings,
      liveEncoderSettings: clientSettings.liveEncoderSettings,
      version: CLIENT_VERSION,
    };

    return await this.sendSuccess(reply, { clientSettings: settings });
  };

  private async getGpuSettings(): Promise<{
    detectedGpus: GpuCapability[];
    selectedGpuId: string;
    isGpuAccelerationEnabled: boolean;
    gpuVendor: string | undefined;
    gpuModel: string | undefined;
    isGpuAccelerationSupported: boolean;
  }> {
    const detectedGpus = await this.ffmpegService.assessGpus().catch((error: unknown) => {
      this.logger.warn('Failed to detect GPUs', error);
      return [];
    });
    const agent = this.config.clientSettings.processingAgent;
    const isGpuAccelerationSupported = detectedGpus.some((gpu) => gpu.available);
    const selected =
      isGpuAccelerationSupported && agent?.processingAgentType === 'gpu'
        ? detectedGpus.find((gpu) => gpu.id === agent.gpuId && gpu.available)
        : undefined;
    return {
      detectedGpus,
      selectedGpuId: selected?.id ?? '',
      isGpuAccelerationEnabled: Boolean(selected),
      gpuVendor: selected?.processingAgentName,
      gpuModel: selected?.processingAgentModel,
      isGpuAccelerationSupported,
    };
  }

  // API: POST /settings/client/gpuAcceleration
  public apiSetGpuAcceleration = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { gpuId } = (request.body ?? {}) as SetGpuAccelerationBody;
    if (typeof gpuId !== 'string') {
      return await this.sendError(reply, 'Select a detected GPU or disabled', 400);
    }
    if (gpuId === '') {
      const cpu = await detectSystemCpu();
      this.config.saveClientSettings({ processingAgent: { processingAgentType: 'cpu', ...cpu } });
      return await this.sendSuccess(reply, {
        result: { selectedGpuId: '', isGpuAccelerationEnabled: false },
      });
    }
    const gpu = (await this.ffmpegService.assessGpus(true)).find((gpu) => gpu.id === gpuId);
    if (!gpu) {
      return await this.sendError(reply, 'Selected GPU is no longer detected', 400);
    }
    if (!gpu.available) {
      return await this.sendError(
        reply,
        gpu.unavailableReason ?? 'Selected GPU is unavailable',
        400
      );
    }
    this.config.saveClientSettings({
      processingAgent: {
        processingAgentType: 'gpu',
        processingAgentName: gpu.processingAgentName,
        processingAgentModel: gpu.processingAgentModel,
        gpuId: gpu.id,
        deviceIndex: gpu.deviceIndex,
        deviceUuid: gpu.deviceUuid,
        backend: gpu.backend,
        renderDevice: gpu.renderDevice,
      },
    });
    return await this.sendSuccess(reply, {
      result: {
        selectedGpuId: gpu.id,
        isGpuAccelerationEnabled: true,
        gpuVendor: gpu.processingAgentName,
        gpuModel: gpu.processingAgentModel,
      },
    });
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
    const parts = request.files({ limits: { fileSize: 20 * 1024 ** 2, files: 2, parts: 4 } });
    let avatarFile: Buffer | undefined;

    for await (const part of parts) {
      if (part.fieldname === 'avatar_file') {
        avatarFile = await part.toBuffer();
      }
    }

    if (avatarFile) {
      const iconBuffer = await sharp(avatarFile, { limitInputPixels: 40_000_000 })
        .resize({ width: 48 })
        .resize(48, 48)
        .png({ compressionLevel: 9 })
        .toBuffer();
      const avatarBuffer = await sharp(avatarFile, { limitInputPixels: 40_000_000 })
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
    const parts = request.files({ limits: { fileSize: 20 * 1024 ** 2, files: 2, parts: 4 } });
    let bannerFile: Buffer | undefined;

    for await (const part of parts) {
      if (part.fieldname === 'banner_file') {
        bannerFile = await part.toBuffer();
      }
    }

    if (bannerFile) {
      const bannerBuffer = await sharp(bannerFile, { limitInputPixels: 40_000_000 })
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

    for await (const part of request.parts({
      limits: { fileSize: 1024 ** 2, files: 12, parts: 14 },
    })) {
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
        const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(jwtToken);

        // s3Config from Node already has nested shape: { bucketName, s3ProviderClientConfig }
        const s3ValidationConfig = nodeSettings.storageConfig
          .s3Config as unknown as S3ValidationConfig;

        for await (const videosData of this.nodeApiService.getVideoDataPages(jwtToken)) {
          const videosForUpdate = videosData as VideoForManifestUpdate[];
          await this.s3Service.updateM3u8ManifestsWithExternalVideosBaseUrl(
            s3ValidationConfig,
            videosForUpdate,
            externalVideosBaseUrl
          );
        }
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

    const validStorageConfig = storageConfig as StorageConfig;
    const response = await this.nodeApiService.storageConfigToggle(jwtToken, validStorageConfig);

    if (!response.isError && storageConfig.storageMode === 's3provider' && s3ValidationConfig) {
      try {
        const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(jwtToken);
        for await (const videosData of this.nodeApiService.getVideoDataPages(jwtToken)) {
          const videosForUpdate = videosData as VideoForManifestUpdate[];
          await this.s3Service.updateM3u8ManifestsWithExternalVideosBaseUrl(
            s3ValidationConfig,
            videosForUpdate,
            externalVideosBaseUrl
          );
        }
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
    const temporary = path.join(tmpdir(), 'moartube-client-import-' + randomUUID() + '.json');
    let found = false;
    try {
      for await (const part of request.files({
        limits: { files: 1, parts: 2, fileSize: 10 * 1024 ** 3 },
      })) {
        if (part.fieldname === 'database_file') {
          found = true;
          await writeUpload(part, temporary, 10 * 1024 ** 3);
        } else {
          part.file.resume();
        }
      }
      if (!found) {
        return await this.sendError(reply, 'database file is missing', 400);
      }
      const input = fs.createReadStream(temporary);
      try {
        return await reply.send(await this.nodeApiService.settingsImportDatabase(jwtToken, input));
      } finally {
        input.destroy();
      }
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  };

  public apiExportDatabase = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const jwtToken = request.session.jwtToken ?? '';
    const stream = await this.nodeApiService.settingsExportDatabase(jwtToken);
    reply.header(
      'Content-Disposition',
      'attachment; filename=database-' + String(Date.now()) + '.json'
    );
    return reply.type('application/json').send(stream);
  };
}
