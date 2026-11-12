import {
  addDonationAddressSchema,
  deleteDonationAddressSchema,
} from '@/validators/node-monetization.js';
import { setNodeIconsBodySchema } from '@/validators/node-icons.js';
import { requireNodeSuccess } from '@/utils/node-actions.js';
import { isValidPublicHost } from '@/utils/public-host.js';
import { setNodeBulletinBodySchema } from '@/validators/node-bulletin.js';
import { setNodeLinksBodySchema } from '@/validators/node-links.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';
import type { Config, ClientSettings } from '@/config/index.js';
import type { S3Service, S3ValidationConfig } from '@/services/s3.js';
import type { UploadedFile, StorageConfig } from '@/types/node-api.js';
import type {
  SetGpuAccelerationBody,
  SetClientEncodingBody,
  SetNodeNameBody,
  SetNodeHeadlineBody,
  SetNodeAboutBody,
  SetNetworkInternalBody,
  SetNetworkExternalBody,
  SetAccountBody,
  SetCloudflareConfigBody,
  SetCloudflareTunnelEnabledBody,
  SetTurnstileConfigBody,
  ToggleDatabaseBody,
  ToggleStorageBody,
  ToggleBooleanBody,
} from '@/types/requests.js';
import { detectSystemCpu } from '@/utils/hardware.js';
import { renderImages } from '@/utils/images.js';
import type { FfmpegService, GpuCapability } from '@/services/ffmpeg.js';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeUpload } from '@/utils/stream-files.js';
import { getStorageMetrics, type StorageMetrics } from '@/utils/storage-metrics.js';
import { CLIENT_VERSION } from '@/utils/version.js';
import { getMemoryMetrics } from '@/utils/memory-metrics.js';
import { getCpuMetrics } from '@/utils/cpu-metrics.js';
import { getGpuMetrics } from '@/utils/gpu-metrics.js';
import { bundledNodePort } from '@/config/bundled-desktop.js';
import { storageMigrationSchema } from '@/validators/storage-migration.js';

export class SettingsController extends BaseController {
  public apiGetMetricsBundle = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    try {
      const jwtToken = request.session.jwtToken ?? '';
      if (jwtToken === '') {
        return await this.sendError(reply, 'Sign in to view metrics', 401);
      }
      const desktopPid = Number(process.env['MOARTUBE_METRICS_ROOT_PID']);
      const rootPid = Number.isInteger(desktopPid) && desktopPid > 0 ? desktopPid : process.pid;
      const collect = async <T>(
        name: string,
        load: () => Promise<T>
      ): Promise<{ isError: false; metrics: T } | { isError: true }> => {
        try {
          return { isError: false as const, metrics: await load() };
        } catch (error) {
          this.logger.debug(`Failed to load ${name} metrics`, error);
          return { isError: true as const };
        }
      };
      const [clientCpu, clientMemory, clientDisk, clientGpu, nodeResult] = await Promise.all([
        collect('client CPU', () => getCpuMetrics(rootPid)),
        collect('client memory', () => getMemoryMetrics(rootPid)),
        collect('client storage', () => this.getClientStorageMetrics()),
        collect('client GPU', () =>
          getGpuMetrics(this.config.clientSettings.processingAgent, rootPid)
        ),
        collect('node', () => this.nodeApiService.getMetricsBundle(jwtToken)),
      ]);
      // The authenticated Node endpoint also validates the Client session's token.
      if (!nodeResult.isError && [401, 403].includes(nodeResult.metrics.status)) {
        return await this.sendError(reply, 'Sign in to view metrics', nodeResult.metrics.status);
      }
      const unavailable = { isError: true as const };
      const node =
        !nodeResult.isError && nodeResult.metrics.status === 200 && !nodeResult.metrics.data.isError
          ? nodeResult.metrics.data.metrics
          : undefined;
      return await this.sendSuccess(reply, {
        metrics: {
          client: { cpu: clientCpu, memory: clientMemory, disk: clientDisk, gpu: clientGpu },
          node: node ?? { cpu: unavailable, memory: unavailable, disk: unavailable },
        },
      });
    } catch (error) {
      this.logger.error('Failed to load metrics', error);
      return await this.sendError(reply, 'Unable to load metrics');
    }
  };

  public apiGetMemoryMetrics = async (
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
        return await this.sendSuccess(reply, {
          metrics: await this.nodeApiService.getMemoryMetrics(jwtToken),
        });
      }
      if (target !== 'client') {
        return await this.sendError(reply, 'Unknown metrics target', 404);
      }
      const desktopPid = Number(process.env['MOARTUBE_METRICS_ROOT_PID']);
      const rootPid = Number.isInteger(desktopPid) && desktopPid > 0 ? desktopPid : process.pid;
      return await this.sendSuccess(reply, { metrics: await getMemoryMetrics(rootPid) });
    } catch (error) {
      this.logger.error('Failed to load memory metrics', error);
      return await this.sendError(reply, 'Unable to load memory metrics');
    }
  };

  public apiGetCpuMetrics = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
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
      if (target !== 'client' && target !== 'node') {
        return await this.sendError(reply, 'Unknown metrics target', 404);
      }
      const desktopPid = Number(process.env['MOARTUBE_METRICS_ROOT_PID']);
      const rootPid = Number.isInteger(desktopPid) && desktopPid > 0 ? desktopPid : process.pid;
      const metrics =
        target === 'client'
          ? await getCpuMetrics(rootPid)
          : await this.nodeApiService.getCpuMetrics(jwtToken);
      return await this.sendSuccess(reply, { metrics });
    } catch (error) {
      this.logger.error('Failed to load CPU metrics', error);
      return await this.sendError(reply, 'Unable to load CPU metrics');
    }
  };

  public apiGetGpuMetrics = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
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
      const desktopPid = Number(process.env['MOARTUBE_METRICS_ROOT_PID']);
      const rootPid = Number.isInteger(desktopPid) && desktopPid > 0 ? desktopPid : process.pid;
      const metrics = await getGpuMetrics(this.config.clientSettings.processingAgent, rootPid);
      return await this.sendSuccess(reply, { metrics });
    } catch (error) {
      this.logger.debug('Failed to load GPU metrics', error);
      return await this.sendError(reply, 'Unable to load GPU metrics');
    }
  };

  private metricsScan: Promise<StorageMetrics> | undefined;

  private getClientStorageMetrics(): Promise<StorageMetrics> {
    this.metricsScan ??= getStorageMetrics(path.join(this.config.paths.data, 'media')).finally(
      () => {
        this.metricsScan = undefined;
      }
    );
    return this.metricsScan;
  }

  private async getNodeStorageMetrics(jwtToken: string): Promise<StorageMetrics> {
    const settings = await this.nodeApiService.getNodeSettings(jwtToken);
    return settings.storageConfig?.storageMode === 's3provider'
      ? { storageMode: 's3provider', mediaBytes: null, availableBytes: null, totalBytes: null }
      : await this.nodeApiService.getStorageMetrics(jwtToken);
  }

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
        return await this.sendSuccess(reply, {
          metrics: await this.getNodeStorageMetrics(jwtToken),
        });
      }
      if (target !== 'client') {
        return await this.sendError(reply, 'Unknown metrics target', 404);
      }
      return await this.sendSuccess(reply, { metrics: await this.getClientStorageMetrics() });
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

  public apiSetClientNetworkAccess = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const jwtToken = request.session.jwtToken ?? '';
    if (!jwtToken) {
      return await this.sendError(reply, 'Sign in to the Node first.', 401);
    }
    const body = request.body as { allowRemoteConnections?: unknown } | null;
    if (typeof body?.allowRemoteConnections !== 'boolean') {
      return await this.sendError(reply, 'Invalid network access setting.', 400);
    }
    try {
      const auth = await this.nodeApiService.isAuthenticated(jwtToken);
      if (auth.isError || !auth.isAuthenticated) {
        return await this.sendError(reply, 'Sign in to the Node first.', 401);
      }
      this.config.saveClientSettings({ allowRemoteConnections: body.allowRemoteConnections });
      return await this.sendSuccess(reply, { restartRequired: true });
    } catch (error) {
      this.logger.error('Failed to save Client network access', error as Error);
      return await this.sendError(reply, 'Unable to save Client network access.', 500);
    }
  };

  public apiSetNodeNetworkAccess = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const jwtToken = request.session.jwtToken ?? '';
    if (!jwtToken) {
      return await this.sendError(reply, 'Sign in to the Node first.', 401);
    }
    const body = request.body as { allowRemoteConnections?: unknown } | null;
    if (typeof body?.allowRemoteConnections !== 'boolean') {
      return await this.sendError(reply, 'Invalid network access setting.', 400);
    }
    try {
      return await reply.send(
        await this.nodeApiService.setNetworkAccess(jwtToken, body.allowRemoteConnections)
      );
    } catch (error) {
      this.logger.error('Failed to save Node network access', error as Error);
      return await this.sendError(
        reply,
        error instanceof Error ? error.message : 'Unable to save Node network access.',
        502
      );
    }
  };

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
      allowRemoteConnections: clientSettings.allowRemoteConnections,
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
      const [iconBuffer, avatarBuffer] = await renderImages(
        avatarFile,
        [
          { width: 48, height: 48, format: 'png' },
          { width: 128, height: 128, format: 'png' },
        ],
        this.ffmpegService.getPath()
      );
      if (!iconBuffer || !avatarBuffer) {
        throw new Error('Avatar processing did not produce both images');
      }

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
      const [bannerBuffer] = await renderImages(
        bannerFile,
        [{ width: 2560, height: 424, format: 'png' }],
        this.ffmpegService.getPath()
      );
      if (!bannerBuffer) {
        throw new Error('Banner processing did not produce an image');
      }
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

  // API: POST /settings/node/personalize/headline
  public apiSetNodeHeadline = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { nodeHeadline } = request.body as SetNodeHeadlineBody;
    const response = await this.nodeApiService.setNodeHeadline(
      request.session.jwtToken ?? '',
      nodeHeadline
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

  // API: POST /settings/node/personalize/bulletin
  public apiSetNodeBulletin = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const jwtToken = request.session.jwtToken ?? '';
    if (jwtToken === '') {
      return await this.sendError(reply, 'Sign in to edit the bulletin', 401);
    }
    const parsed = setNodeBulletinBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return await this.sendError(
        reply,
        'Use up to 10 bulletin items, each with 1 to 1000 characters',
        400
      );
    }
    try {
      return await reply.send(
        await this.nodeApiService.setNodeBulletin(jwtToken, parsed.data.nodeBulletin)
      );
    } catch (error) {
      this.logger.error('Unable to save node bulletin', error);
      return await this.sendError(reply, 'Unable to save bulletin. Please try again.', 502);
    }
  };

  public apiGetMonetization = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    if ((request.session.jwtToken ?? '') === '') {
      return await this.sendError(reply, 'Sign in to edit monetization', 401);
    }
    try {
      return await reply.send(await this.nodeApiService.getMonetizationAll());
    } catch (error) {
      this.logger.error('Unable to load donation addresses', error);
      return await this.sendError(
        reply,
        'Unable to load donation addresses. Please try again.',
        502
      );
    }
  };

  public apiAddDonationAddress = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const token = request.session.jwtToken ?? '';
    if (token === '') {
      return await this.sendError(reply, 'Sign in to edit monetization', 401);
    }
    const parsed = addDonationAddressSchema.safeParse(request.body);
    if (!parsed.success) {
      return await this.sendError(
        reply,
        'Enter a wallet address and matching ETH or BNB chain and currency',
        400
      );
    }
    try {
      const addresses = await this.nodeApiService.getMonetizationAll();
      if (addresses.isError || !Array.isArray(addresses.cryptoWalletAddresses)) {
        return await this.sendError(
          reply,
          'Unable to check donation addresses. Please try again.',
          502
        );
      }
      if (addresses.cryptoWalletAddresses.length >= 10) {
        return await this.sendError(reply, 'Use up to 10 donation addresses', 400);
      }
      const { walletAddress, chain, currency } = parsed.data;
      return await reply.send(
        await this.nodeApiService.addMonetizationAddress(token, walletAddress, chain, currency)
      );
    } catch (error) {
      this.logger.error('Unable to add donation address', error);
      return await this.sendError(reply, 'Unable to add donation address. Please try again.', 502);
    }
  };

  public apiDeleteDonationAddress = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const token = request.session.jwtToken ?? '';
    if (token === '') {
      return await this.sendError(reply, 'Sign in to edit monetization', 401);
    }
    const parsed = deleteDonationAddressSchema.safeParse(request.body);
    if (!parsed.success) {
      return await this.sendError(reply, 'Choose a saved donation address', 400);
    }
    try {
      return await reply.send(
        await this.nodeApiService.deleteMonetizationAddress(
          token,
          parsed.data.cryptoWalletAddressId
        )
      );
    } catch (error) {
      this.logger.error('Unable to remove donation address', error);
      return await this.sendError(
        reply,
        'Unable to remove donation address. Please try again.',
        502
      );
    }
  };

  // API: POST /settings/node/personalize/links
  public apiSetNodeLinks = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const jwtToken = request.session.jwtToken ?? '';
    if (jwtToken === '') {
      return await this.sendError(reply, 'Sign in to edit the links', 401);
    }
    const parsed = setNodeLinksBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return await this.sendError(
        reply,
        'Use up to 10 links, each with an HTTP(S) URL and a description of 1 to 1000 characters',
        400
      );
    }
    try {
      return await reply.send(
        await this.nodeApiService.setNodeLinks(jwtToken, parsed.data.nodeLinks)
      );
    } catch (error) {
      this.logger.error('Unable to save node links', error);
      return await this.sendError(reply, 'Unable to save links. Please try again.', 502);
    }
  };

  // API: POST /settings/node/personalize/icons
  public apiSetNodeIcons = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const jwtToken = request.session.jwtToken ?? '';
    if (jwtToken === '') {
      return await this.sendError(reply, 'Sign in to edit the icons', 401);
    }
    const parsed = setNodeIconsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return await this.sendError(
        reply,
        'Use up to 5 icons, each with an HTTP(S) URL and an SVG graphic of 1 to 50000 characters',
        400
      );
    }
    try {
      return await reply.send(
        await this.nodeApiService.setNodeIcons(jwtToken, parsed.data.nodeIcons)
      );
    } catch (error) {
      this.logger.error('Unable to save node icons', error);
      return await this.sendError(reply, 'Unable to save icons. Please try again.', 502);
    }
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
      try {
        requireNodeSuccess(await this.nodeApiService.restartNode(request.session.jwtToken ?? ''));
      } catch (error) {
        this.logger.error('Failed to restart node after secure connection change', error as Error);
        return await this.sendError(
          reply,
          'Settings saved, but Node restart failed; the previous connection remains selected.'
        );
      }
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

  public apiGetWorkerCount = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    if ((request.session.jwtToken ?? '') === '') {
      return await this.sendError(reply, 'Sign in to the Node first.', 401);
    }
    try {
      return await reply.send(
        await this.nodeApiService.getWorkerCount(request.session.jwtToken ?? '')
      );
    } catch (error) {
      return await this.sendError(
        reply,
        error instanceof Error ? error.message : 'Unable to read worker count.',
        409
      );
    }
  };

  public apiSetWorkerCount = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    if ((request.session.jwtToken ?? '') === '') {
      return await this.sendError(reply, 'Sign in to the Node first.', 401);
    }
    const body = request.body as { workerCount?: unknown; confirmDecrease?: unknown } | null;
    if (
      !body ||
      typeof body.workerCount !== 'number' ||
      !Number.isInteger(body.workerCount) ||
      body.workerCount < 0 ||
      (body.confirmDecrease !== undefined && typeof body.confirmDecrease !== 'boolean')
    ) {
      return await this.sendError(reply, 'Invalid worker count request.', 400);
    }
    try {
      return await reply.send(
        await this.nodeApiService.setWorkerCount(
          request.session.jwtToken ?? '',
          body.workerCount,
          body.confirmDecrease === true
        )
      );
    } catch (error) {
      return await this.sendError(
        reply,
        error instanceof Error ? error.message : 'Unable to change worker count.',
        409
      );
    }
  };

  // API: POST /settings/node/network/internal
  public apiSetNetworkInternal = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { nodeListeningPort } = request.body as SetNetworkInternalBody;
    const jwtToken = request.session.jwtToken ?? '';
    const response = await this.nodeApiService.setNetworkInternal(jwtToken, nodeListeningPort);
    if (!response.isError) {
      try {
        requireNodeSuccess(await this.nodeApiService.restartNode(jwtToken));
      } catch (error) {
        this.logger.error('Failed to restart node after network internal change', error as Error);
        return await this.sendError(
          reply,
          'Settings saved, but Node restart failed; the previous connection remains selected.'
        );
      }
      const settings = this.config.clientSettings;
      settings.nodePort = nodeListeningPort;
      this.config.saveClientSettings(settings);
    }
    return await reply.send(response);
  };

  // API: POST /settings/node/network/external
  public apiSetNetworkExternal = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { publicNodeProtocol, publicNodeAddress, publicNodePort } =
      request.body as SetNetworkExternalBody;
    if (typeof publicNodeAddress !== 'string' || !isValidPublicHost(publicNodeAddress)) {
      return await this.sendError(
        reply,
        'Public Node address must be a domain or IP address without a protocol, port, or path.',
        400
      );
    }
    const jwtToken = request.session.jwtToken ?? '';
    const response = await this.nodeApiService.setExternalNetwork(
      jwtToken,
      publicNodeProtocol,
      publicNodeAddress.trim(),
      publicNodePort
    );

    return await reply.send(response);
  };

  public apiSetCloudflareConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const jwtToken = request.session.jwtToken ?? '';
    if (jwtToken === '') {
      return await this.sendError(reply, 'Sign in to configure Cloudflare CDN', 401);
    }
    const body = request.body as Partial<SetCloudflareConfigBody> | null;
    if (
      typeof body?.cloudflareEmailAddress !== 'string' ||
      typeof body.cloudflareZoneId !== 'string' ||
      typeof body.cloudflareGlobalApiKey !== 'string'
    ) {
      return await this.sendError(reply, 'Cloudflare credentials are required', 400);
    }
    try {
      const response = await this.nodeApiService.setCloudflareConfiguration(
        jwtToken,
        body.cloudflareEmailAddress,
        body.cloudflareZoneId,
        body.cloudflareGlobalApiKey
      );
      return await reply.status(response.status).send(response.data);
    } catch {
      return await this.sendError(
        reply,
        'CDN settings could not be confirmed. Refresh settings before retrying.',
        502
      );
    }
  };

  public apiClearCloudflareConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const jwtToken = request.session.jwtToken ?? '';
    if (jwtToken === '') {
      return await this.sendError(reply, 'Sign in to configure Cloudflare CDN', 401);
    }
    try {
      const response = await this.nodeApiService.clearCloudflareConfiguration(jwtToken);
      return await reply.status(response.status).send(response.data);
    } catch {
      return await this.sendError(
        reply,
        'CDN settings could not be confirmed. Refresh settings before retrying.',
        502
      );
    }
  };

  public apiRetryCloudflareConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const jwtToken = request.session.jwtToken ?? '';
    if (jwtToken === '') {
      return await this.sendError(reply, 'Sign in to retry Cloudflare CDN setup', 401);
    }
    const transitionId = (request.body as { transitionId?: unknown } | undefined)?.transitionId;
    if (typeof transitionId !== 'string' || transitionId.length > 100) {
      return await this.sendError(reply, 'A CDN transition ID is required.', 400);
    }
    try {
      const response = await this.nodeApiService.retryCloudflareConfiguration(
        jwtToken,
        transitionId
      );
      return await reply.status(response.status).send(response.data);
    } catch {
      return await this.sendError(
        reply,
        'CDN recovery could not be confirmed. Retry after checking your connection.',
        502
      );
    }
  };

  public apiSetCloudflareTunnelEnabled = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const jwtToken = request.session.jwtToken ?? '';
    if (jwtToken === '') {
      return this.sendError(reply, 'Sign in to change Cloudflare Tunnels', 401);
    }
    const body = request.body as Partial<SetCloudflareTunnelEnabledBody> | null;
    if (typeof body?.isEnabled !== 'boolean') {
      return this.sendError(reply, 'isEnabled must be a boolean', 400);
    }
    try {
      const response = await this.nodeApiService.setCloudflareTunnelEnabled(
        jwtToken,
        body.isEnabled
      );
      return await reply.status(response.status).send(response.data);
    } catch {
      return this.sendError(
        reply,
        'Tunnel preference could not be confirmed. Refresh settings before retrying.',
        502
      );
    }
  };

  public apiGetCloudflareTunnel = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    const jwtToken = request.session.jwtToken ?? '';
    if (jwtToken === '') {
      return this.sendError(reply, 'Sign in to view Cloudflare Tunnels', 401);
    }
    try {
      return await reply.send({
        isError: false,
        tunnel: await this.nodeApiService.getCloudflareTunnel(jwtToken),
      });
    } catch {
      return this.sendError(reply, 'Cloudflare Tunnel status is unavailable', 503);
    }
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
    let response;
    try {
      response = await this.nodeApiService.databaseConfigToggle(jwtToken, databaseConfig);
    } catch (error) {
      return await this.sendError(
        reply,
        error instanceof Error ? error.message : 'Could not change database configuration'
      );
    }

    if (!response.isError && response['restartRequired'] !== true) {
      try {
        requireNodeSuccess(await this.nodeApiService.restartNode(jwtToken));
      } catch (error) {
        this.logger.error('Failed to restart node after database toggle', error as Error);
        return await this.sendError(
          reply,
          'Database settings saved, but Node restart failed; activation is pending.'
        );
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

    return await reply.send(response);
  };

  public apiMigrateStorage = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const jwtToken = request.session.jwtToken ?? '';
    if (!jwtToken) {
      return await this.sendError(reply, 'Sign in to the Node first.', 401);
    }
    const parsed = storageMigrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return await this.sendError(reply, 'Invalid migration configuration.', 400);
    }
    try {
      const migration = parsed.data;
      if ('source' in migration) {
        await this.s3Service.validateS3Config(migration.source, false);
      }
      if ('destination' in migration) {
        await this.s3Service.validateS3Config(migration.destination, false);
      }
      return await reply.send(await this.nodeApiService.migrateStorage(jwtToken, migration));
    } catch {
      return await this.sendError(
        reply,
        'Migration failed. Destination data may be partially overwritten. Check the S3 configuration and Node connection before trying again.',
        502
      );
    }
  };

  public apiSetAccountCredentials = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const { username, password } = request.body as SetAccountBody;
    const jwtToken = request.session.jwtToken ?? '';
    const bundled = bundledNodePort() !== undefined;
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      (username === '') !== (password === '') ||
      (!bundled && username === '')
    ) {
      return await this.sendError(
        reply,
        'Enter both username and password, or clear both for automatic sign-in.',
        400
      );
    }
    const automatic = bundled && username === '' && password === '';
    const response = await this.nodeApiService.setAccountCredentials(
      jwtToken,
      automatic ? 'admin' : username,
      automatic ? 'admin' : password
    );
    if (bundled && !response.isError) {
      this.config.saveClientSettings({ bundledNodeLoginRequired: !automatic });
      return await reply.send({
        ...response,
        message: automatic
          ? 'Automatic sign-in will be enabled the next time you start MoarTube.'
          : 'Sign-in will be required the next time you start MoarTube.',
      });
    }
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
