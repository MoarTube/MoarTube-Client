import type { AxiosInstance } from 'axios';
import axios from 'axios';
import FormData from 'form-data';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import fs from 'node:fs';
import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { Config } from '@/config/index.js';
import type {
  AuthResponse,
  NodeSettings,
  NewContentCounts,
  Video,
  VideoDataAllResponse,
  BaseNodeResponse,
  StreamVideoResponse,
  CreateVideoResponse,
  SourceFileExtensionResponse,
  VideoDataResponse,
  DeleteVideosResponse,
  FinalizeVideosResponse,
  VideoSourcesResponse,
  VideoTagsResponse,
  VideoTagsAllResponse,
  VideoPublishesResponse,
  VideoPermissionsResponse,
  UploadedFile,
  DatabaseConfig,
  StorageConfig,
  GetLinksResponse,
  GetMonetizationResponse,
  GetCommentsResponse,
  GetReportsResponse,
  VideoBandwidthResponse,
} from '@/types/node-api.js';

export interface UploadStreamOptions {
  videoId: string;
  format: string;
  resolution: string;
  manifestBuffer: Buffer;
  segmentBuffer: Buffer;
  manifestFileName: string;
  segmentFileName: string;
}

export interface StreamVideoOptions {
  title: string;
  description: string;
  tags: string;
  rtmpPort: number;
  uuid: string;
  resolution: string;
  isRecordingStreamRemotely: boolean;
  isRecordingStreamLocally: boolean;
  networkAddress: string;
  videoId?: string;
}

/**
 * Service for communicating with the MoarTube Node API
 * Replaces _src/utils/node-communications.js
 */
export class NodeApiService extends BaseService {
  // private readonly settingsRepo: SettingsRepository;
  private readonly config: Config;
  private readonly httpAgent = new HttpAgent({ keepAlive: true, keepAliveMsecs: 10000 });
  private readonly httpsAgent = new HttpsAgent({ keepAlive: true, keepAliveMsecs: 10000 });

  constructor(logger: Logger, config: Config) {
    super('nodeApiService', logger);
    this.config = config;
    // this.settingsRepo = settingsRepository;
  }

  private getBaseUrl(): Promise<string> {
    // We read fresh settings every time to ensure we use valid IP/Port if they change
    const settings = this.config.clientSettings;
    return Promise.resolve(
      `${settings.nodeHttpProtocol}://${settings.nodeIp}:${String(settings.nodePort)}`
    );
  }

  private async getClient(): Promise<AxiosInstance> {
    const baseURL = await this.getBaseUrl();
    return axios.create({
      baseURL,
      timeout: 10000,
      validateStatus: () => true, // Handle status codes manually
    });
  }

  /**
   * Check if user is authenticated with the Node
   */
  public async isAuthenticated(jwtToken?: string): Promise<AuthResponse> {
    if (jwtToken === undefined || jwtToken === '') {
      return { isError: false, isAuthenticated: false };
    }

    try {
      const client = await this.getClient();
      const response = await client.get('/account/authenticated', {
        headers: { Authorization: `Bearer ${jwtToken}` },
      });
      return response.data as AuthResponse;
    } catch (error) {
      this.logger.error('isAuthenticated check failed', error);
      return { isError: true, isAuthenticated: false, message: 'Communication error' };
    }
  }

  /**
   * Perform Heartbeat check
   */
  public async heartbeat(protocol: string, ip: string, port: number): Promise<unknown> {
    const url = `${protocol}://${ip}:${String(port)}/status/heartbeat`;
    const response = await axios.get(url, { timeout: 5000 });
    return response.data as GetLinksResponse;
  }

  /**
   * Sign In
   */
  public async signIn(
    username: string,
    password: string,
    rememberMe: boolean
  ): Promise<AuthResponse> {
    const client = await this.getClient();
    const settings = this.config.clientSettings;

    const payload = {
      username,
      password,
      moarTubeNodeHttpProtocol: settings.nodeHttpProtocol,
      moarTubeNodeIp: settings.nodeIp,
      moarTubeNodePort: settings.nodePort,
      rememberMe,
    };

    const response = await client.post('/account/signin', payload);
    return response.data as AuthResponse;
  }

  /**
   * Get Videos (Search)
   */
  public async searchVideos(
    jwtToken: string | undefined,
    searchTerm: string,
    sortTerm: string,
    tagTerm: string,
    tagLimit: number,
    timestamp: number
  ): Promise<Video[]> {
    const client = await this.getClient();
    const headers =
      jwtToken !== undefined && jwtToken !== '' ? { Authorization: `Bearer ${jwtToken}` } : {};

    const response = await client.get('/videos/search', {
      params: {
        searchTerm,
        sortTerm,
        tagTerm,
        tagLimit,
        timestamp,
      },
      headers,
    });

    return response.data as Video[];
  }

  private async postAuthenticated<T = unknown>(
    jwtToken: string,
    url: string,
    data: unknown = {}
  ): Promise<T> {
    const client = await this.getClient();
    const response = await client.post(url, data, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as T;
  }

  public async setVideoPublishing(jwtToken: string, videoId: string): Promise<unknown> {
    return this.postAuthenticated(jwtToken, '/videos/publishing', { videoId });
  }

  public async createVideo(
    jwtToken: string,
    title: string,
    description: string,
    tags: string
  ): Promise<CreateVideoResponse> {
    return this.postAuthenticated<CreateVideoResponse>(jwtToken, '/videos/import', {
      title,
      description,
      tags,
    });
  }

  public async getExternalVideosBaseUrl(jwtToken: string): Promise<string> {
    const client = await this.getClient();
    const response = await client.get('/external/videos/baseUrl', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return (response.data as { externalVideosBaseUrl: string }).externalVideosBaseUrl;
  }

  public async getNodeSettings(jwtToken: string): Promise<NodeSettings> {
    const client = await this.getClient();
    const response = await client.get('/settings', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return (response.data as { nodeSettings: NodeSettings }).nodeSettings;
  }

  public async searchVideosAll(
    searchTerm: string,
    sortTerm: string,
    tagTerm: string,
    tagLimit: number,
    timestamp: number
  ): Promise<Video[]> {
    const client = await this.getClient();
    const response = await client.get('/node/search', {
      params: { searchTerm, sortTerm, tagTerm, tagLimit, timestamp },
    });
    return response.data as Video[];
  }

  public async getNewContentCounts(
    jwtToken: string
  ): Promise<{ newContentCounts: NewContentCounts }> {
    const client = await this.getClient();
    const response = await client.get('/node/newContentCounts', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as { newContentCounts: NewContentCounts };
  }

  public async setContentChecked(jwtToken: string, contentType: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/node/contentChecked', {
      contentType,
    });
  }

  public async setVideoFormatResolutionPublished(
    jwtToken: string,
    videoId: string,
    format: string,
    resolution: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/videos/${videoId}/published`, {
      format,
      resolution,
    });
  }

  public async getVideoDataAll(jwtToken: string): Promise<VideoDataAllResponse> {
    const client = await this.getClient();
    const response = await client.get('/videos/data/all', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as VideoDataAllResponse;
  }

  // Settings Methods

  public async getAvatar(jwtToken: string): Promise<Buffer> {
    const client = await this.getClient();
    const response = await client.get('/settings/avatar', {
      headers: { Authorization: `Bearer ${jwtToken}` },
      responseType: 'arraybuffer',
    });

    if (response.status !== 200) {
      throw new Error(`Failed to retrieve avatar: ${String(response.status)}`);
    }

    return Buffer.from(response.data as ArrayBuffer);
  }

  public async setAvatar(jwtToken: string, icon: Buffer, avatar: Buffer): Promise<unknown> {
    const formData = new FormData();
    formData.append('iconFile', icon, 'icon.png');
    formData.append('avatarFile', avatar, 'avatar.png');

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post('/settings/avatar', formData, { headers });
    const responseData: unknown = response.data;
    return responseData;
  }

  public async getBanner(jwtToken: string): Promise<Buffer> {
    const client = await this.getClient();
    const response = await client.get('/settings/banner', {
      headers: { Authorization: `Bearer ${jwtToken}` },
      responseType: 'arraybuffer',
    });

    if (response.status !== 200) {
      throw new Error(`Failed to retrieve banner: ${String(response.status)}`);
    }

    return Buffer.from(response.data as ArrayBuffer);
  }

  public async setBanner(jwtToken: string, banner: Buffer): Promise<unknown> {
    const formData = new FormData();
    formData.append('bannerFile', banner, 'banner.png');

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post('/settings/banner', formData, { headers });
    const responseData: unknown = response.data;
    return responseData;
  }

  public async setNodeName(jwtToken: string, nodeName: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/personalize/name', {
      nodeName,
    });
  }

  public async setNodeAbout(jwtToken: string, nodeAbout: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/personalize/about', {
      nodeAbout,
    });
  }

  public async setNodeId(jwtToken: string, nodeId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/personalize/id', {
      nodeId,
    });
  }

  public async setSecureConnection(
    jwtToken: string,
    isSecure: boolean,
    keyFile: UploadedFile | undefined,
    certFile: UploadedFile | undefined,
    caFiles: UploadedFile | UploadedFile[] | undefined
  ): Promise<BaseNodeResponse> {
    const formData = new FormData();

    if (keyFile !== undefined) {
      formData.append('keyFile', keyFile.buffer, 'private_key.pem');
    }

    if (certFile !== undefined) {
      formData.append('certFile', certFile.buffer, 'certificate.pem');
    }

    if (caFiles !== undefined) {
      if (Array.isArray(caFiles)) {
        for (const caFile of caFiles) {
          formData.append('caFiles', caFile.buffer, caFile.filename);
        }
      } else {
        formData.append('caFiles', caFiles.buffer, caFiles.filename);
      }
    }

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post('/settings/secure', formData, {
      params: { isSecure },
      headers,
    });
    return response.data as BaseNodeResponse;
  }

  public async setNetworkInternal(
    jwtToken: string,
    nodeListeningPort: number
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/network/internal', {
      nodeListeningPort,
    });
  }

  public async setExternalNetwork(
    jwtToken: string,
    publicNodeProtocol: string,
    publicNodeAddress: string,
    publicNodePort: number
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/network/external', {
      publicNodeProtocol,
      publicNodeAddress,
      publicNodePort,
    });
  }

  public async setCloudflareConfiguration(
    jwtToken: string,
    email: string,
    zoneId: string,
    apiKey: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/cloudflare/configure', {
      cloudflareEmailAddress: email,
      cloudflareZoneId: zoneId,
      cloudflareGlobalApiKey: apiKey,
    });
  }

  public async clearCloudflareConfiguration(jwtToken: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/cloudflare/clear');
  }

  public async setCloudflareTurnstileConfiguration(
    jwtToken: string,
    siteKey: string,
    secretKey: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(
      jwtToken,
      '/settings/cloudflare/turnstile/configure',
      { cloudflareTurnstileSiteKey: siteKey, cloudflareTurnstileSecretKey: secretKey }
    );
  }

  public async clearCloudflareTurnstileConfiguration(jwtToken: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(
      jwtToken,
      '/settings/cloudflare/turnstile/clear'
    );
  }

  public async databaseConfigToggle(
    jwtToken: string,
    databaseConfig: DatabaseConfig
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/database/config/toggle', {
      databaseConfig,
    });
  }

  public async storageConfigToggle(
    jwtToken: string,
    storageConfig: StorageConfig
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/storage/config/toggle', {
      storageConfig,
    });
  }

  public async restartNode(jwtToken: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/restart', {});
  }

  public async setAccountCredentials(
    jwtToken: string,
    username: string,
    password: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/account', {
      username,
      password,
    });
  }

  public async settingsImportDatabase(
    jwtToken: string,
    databaseFile: Buffer
  ): Promise<BaseNodeResponse> {
    const formData = new FormData();
    formData.append('databaseFile', databaseFile, 'database.json');

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post('/settings/import/database', formData, { headers });
    return response.data as BaseNodeResponse;
  }

  public async settingsExportDatabase(jwtToken: string): Promise<unknown> {
    const client = await this.getClient();
    const response = await client.get('/settings/export/database', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data;
  }

  public async commentsToggle(jwtToken: string, isEnabled: boolean): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/comments/toggle', {
      isEnabled,
    });
  }

  public async likesToggle(jwtToken: string, isEnabled: boolean): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/likes/toggle', {
      isEnabled,
    });
  }

  public async dislikesToggle(jwtToken: string, isEnabled: boolean): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/dislikes/toggle', {
      isEnabled,
    });
  }

  // Links Methods

  public async getLinks(): Promise<GetLinksResponse> {
    const client = await this.getClient();
    const response = await client.get('/links/all');
    return response.data as GetLinksResponse;
  }

  public async addLink(
    jwtToken: string,
    url: string,
    svgGraphic: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/links/add', { url, svgGraphic });
  }

  public async deleteLink(jwtToken: string, linkId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/links/delete', { linkId });
  }

  // Monetization Methods

  public async getMonetizationAll(): Promise<GetMonetizationResponse> {
    const client = await this.getClient();
    const response = await client.get('/monetization/all');
    return response.data as GetMonetizationResponse;
  }

  public async addMonetizationAddress(
    jwtToken: string,
    walletAddress: string,
    chain: string,
    currency: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/monetization/add', {
      walletAddress,
      chain,
      currency,
    });
  }

  public async deleteMonetizationAddress(
    jwtToken: string,
    cryptoWalletAddressId: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/monetization/delete', {
      cryptoWalletAddressId,
    });
  }

  // Comments Methods

  public async getVideoComments(
    jwtToken: string,
    videoId: string,
    timestamp: number,
    type: string,
    sort: string
  ): Promise<GetCommentsResponse> {
    const client = await this.getClient();
    const response = await client.get(`/videos/${videoId}/comments`, {
      params: { timestamp, type, sort },
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as GetCommentsResponse;
  }

  public async searchComments(
    jwtToken: string,
    videoId: string,
    searchTerm: string,
    sortDirection: string,
    limit: number,
    timestamp: number
  ): Promise<GetCommentsResponse> {
    const client = await this.getClient();
    const response = await client.get('/comments/search', {
      params: { videoId, searchTerm, sortDirection, limit, timestamp },
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as GetCommentsResponse;
  }

  public async removeComment(
    jwtToken: string,
    videoId: string,
    commentId: string,
    timestamp: number
  ): Promise<BaseNodeResponse> {
    const client = await this.getClient();
    const response = await client.delete(`/videos/${videoId}/comments/${commentId}/delete`, {
      params: { timestamp },
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as BaseNodeResponse;
  }

  // Reports Methods - Videos

  public async getVideoReports(jwtToken: string): Promise<GetReportsResponse> {
    const client = await this.getClient();
    const response = await client.get('/reports/videos', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as GetReportsResponse;
  }

  public async getVideoReportsArchive(jwtToken: string): Promise<GetReportsResponse> {
    const client = await this.getClient();
    const response = await client.get('/reports/archive/videos', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as GetReportsResponse;
  }

  public async archiveVideoReport(jwtToken: string, reportId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/reports/videos/archive', {
      reportId,
    });
  }

  public async removeVideoReport(jwtToken: string, reportId: string): Promise<BaseNodeResponse> {
    const client = await this.getClient();
    const response = await client.delete(`/reports/videos/${reportId}/delete`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as BaseNodeResponse;
  }

  public async removeVideoReportArchive(
    jwtToken: string,
    archiveId: string
  ): Promise<BaseNodeResponse> {
    const client = await this.getClient();
    const response = await client.delete(`/reports/archive/videos/${archiveId}/delete`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as BaseNodeResponse;
  }

  // Reports Methods - Comments

  public async getCommentReports(jwtToken: string): Promise<GetReportsResponse> {
    const client = await this.getClient();
    const response = await client.get('/reports/comments', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as GetReportsResponse;
  }

  public async getCommentReportsArchive(jwtToken: string): Promise<GetReportsResponse> {
    const client = await this.getClient();
    const response = await client.get('/reports/archive/comments', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as GetReportsResponse;
  }

  public async archiveCommentReport(jwtToken: string, reportId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/reports/comments/archive', {
      reportId,
    });
  }

  public async removeCommentReport(jwtToken: string, reportId: string): Promise<BaseNodeResponse> {
    const client = await this.getClient();
    const response = await client.delete(`/reports/comments/${reportId}/delete`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as BaseNodeResponse;
  }

  public async removeCommentReportArchive(
    jwtToken: string,
    archiveId: string
  ): Promise<BaseNodeResponse> {
    const client = await this.getClient();
    const response = await client.delete(`/reports/archive/comments/${archiveId}/delete`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as BaseNodeResponse;
  }

  public async reportVideosToggle(jwtToken: string, isEnabled: boolean): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/reports/toggle', {
      isEnabled,
    });
  }

  // Videos Methods

  public async getVideosTags(jwtToken: string): Promise<VideoTagsResponse> {
    const client = await this.getClient();
    const response = await client.get('/videos/tags', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as VideoTagsResponse;
  }

  public async getVideosTagsAll(jwtToken: string): Promise<VideoTagsAllResponse> {
    const client = await this.getClient();
    const response = await client.get('/videos/tags/all', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as VideoTagsAllResponse;
  }

  public async getVideoPublishes(
    jwtToken: string,
    videoId: string
  ): Promise<VideoPublishesResponse> {
    const client = await this.getClient();
    const response = await client.get(`/videos/${videoId}/publishes`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as VideoPublishesResponse;
  }

  public async setVideoData(
    jwtToken: string,
    videoId: string,
    title: string,
    description: string,
    tags: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/videos/${videoId}/data`, {
      title,
      description,
      tags,
    });
  }

  public async deleteVideos(jwtToken: string, videoIds: string[]): Promise<DeleteVideosResponse> {
    return this.postAuthenticated<DeleteVideosResponse>(jwtToken, '/videos/delete', { videoIds });
  }

  public async finalizeVideos(
    jwtToken: string,
    videoIds: string[]
  ): Promise<FinalizeVideosResponse> {
    return this.postAuthenticated<FinalizeVideosResponse>(jwtToken, '/videos/finalize', {
      videoIds,
    });
  }

  public async addVideoToIndex(
    jwtToken: string,
    videoId: string,
    containsAdultContent: boolean,
    termsOfServiceAgreed: boolean,
    cloudflareTurnstileToken: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/videos/${videoId}/index/add`, {
      containsAdultContent,
      termsOfServiceAgreed,
      cloudflareTurnstileToken,
    });
  }

  public async removeVideoFromIndex(
    jwtToken: string,
    videoId: string,
    cloudflareTurnstileToken: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/videos/${videoId}/index/remove`, {
      cloudflareTurnstileToken,
    });
  }

  public async setIsIndexOutdated(jwtToken: string, videoId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/videos/${videoId}/index/outdated`);
  }

  public async getVideoPermissions(
    jwtToken: string,
    videoId: string
  ): Promise<VideoPermissionsResponse> {
    const client = await this.getClient();
    const response = await client.get(`/videos/${videoId}/permissions`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as VideoPermissionsResponse;
  }

  public async postVideoPermissions(
    jwtToken: string,
    videoId: string,
    type: string,
    isEnabled: boolean
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/videos/${videoId}/permissions`, {
      type,
      isEnabled,
    });
  }

  public async getVideoSources(videoId: string): Promise<VideoSourcesResponse> {
    const client = await this.getClient();
    const response = await client.get(`/videos/${videoId}/sources`);
    return response.data as VideoSourcesResponse;
  }

  public async liveChatToggle(jwtToken: string, isEnabled: boolean): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/settings/liveChat/toggle', {
      isEnabled,
    });
  }

  public async setSourceFileExtension(
    jwtToken: string,
    videoId: string,
    extension: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(
      jwtToken,
      `/videos/${videoId}/sourceFileExtension`,
      { sourceFileExtension: extension }
    );
  }

  public async setVideoImported(jwtToken: string, videoId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, '/videos/imported', { videoId });
  }

  public async stopVideoImporting(jwtToken: string, videoId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/videos/${videoId}/importing/stop`, {
      videoId,
    });
  }

  public async stopVideoPublishing(jwtToken: string, videoId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(
      jwtToken,
      `/videos/${videoId}/publishing/stop`,
      { videoId }
    );
  }

  public async unpublishVideo(
    jwtToken: string,
    videoId: string,
    format: string,
    resolution: string
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/videos/${videoId}/unpublish`, {
      format,
      resolution,
    });
  }

  public async getVideoData(
    _jwtToken: string | undefined,
    videoId: string
  ): Promise<VideoDataResponse> {
    const client = await this.getClient();
    // Legacy behavior: GET /videos/:videoId/data
    const response = await client.get(`/videos/${videoId}/data`);
    return response.data as VideoDataResponse;
  }

  public async getSourceFileExtension(
    jwtToken: string,
    videoId: string
  ): Promise<SourceFileExtensionResponse> {
    const client = await this.getClient();
    const response = await client.get(`/videos/${videoId}/sourceFileExtension`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as SourceFileExtensionResponse;
  }

  public async setVideoPublished(jwtToken: string, videoId: string): Promise<unknown> {
    return this.postAuthenticated(jwtToken, '/videos/published', { videoId });
  }

  public async uploadVideo(
    jwtToken: string,
    videoId: string,
    format: string,
    resolution: string,
    files: Array<{ fileName: string; filePath: string; contentType: string }>
  ): Promise<unknown> {
    const formData = new FormData();

    for (const file of files) {
      const fileStream = fs.createReadStream(file.filePath);
      formData.append('video_files', fileStream, {
        filename: file.fileName,
        contentType: file.contentType,
      });
    }

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post(`/videos/${videoId}/upload`, formData, {
      params: { format, resolution },
      headers,
    });
    return response.data;
  }

  public async uploadStream(jwtToken: string, options: UploadStreamOptions): Promise<unknown> {
    const {
      videoId,
      format,
      resolution,
      manifestBuffer,
      segmentBuffer,
      manifestFileName,
      segmentFileName,
    } = options;
    const formData = new FormData();

    formData.append('video_files', manifestBuffer, {
      filename: manifestFileName,
      contentType: 'application/vnd.apple.mpegurl',
    });

    formData.append('video_files', segmentBuffer, {
      filename: segmentFileName,
      contentType: 'video/mp2t',
    });

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post(`/videos/${videoId}/stream`, formData, {
      params: { format, resolution },
      headers,
      timeout: 15000,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });

    return response.data;
  }

  public async setVideoLengths(
    jwtToken: string,
    videoId: string,
    lengthSeconds: number,
    lengthTimestamp: string
  ): Promise<unknown> {
    return this.postAuthenticated(jwtToken, `/videos/${videoId}/lengths`, {
      lengthSeconds,
      lengthTimestamp,
    });
  }

  public async removeAdaptiveStreamSegment(
    jwtToken: string,
    videoId: string,
    format: string,
    resolution: string,
    segmentName: string
  ): Promise<unknown> {
    return this.postAuthenticated(
      jwtToken,
      `/streams/${videoId}/adaptive/${format}/${resolution}/segments/remove`,
      { segmentName }
    );
  }

  public async getVideoBandwidth(
    jwtToken: string,
    videoId: string
  ): Promise<VideoBandwidthResponse> {
    const client = await this.getClient();
    const response = await client.get(`/streams/${videoId}/bandwidth`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return response.data as VideoBandwidthResponse;
  }

  public async stopVideoStreaming(jwtToken: string, videoId: string): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/streams/${videoId}/stop`, {});
  }

  public async setThumbnail(
    jwtToken: string,
    videoId: string,
    buffer: Buffer
  ): Promise<BaseNodeResponse> {
    const formData = new FormData();
    formData.append('thumbnailFile', buffer, 'thumbnail.jpg');

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post(`/videos/${videoId}/images/thumbnail`, formData, {
      headers,
    });
    return response.data as BaseNodeResponse;
  }

  public async setPreview(
    jwtToken: string,
    videoId: string,
    buffer: Buffer
  ): Promise<BaseNodeResponse> {
    const formData = new FormData();
    formData.append('previewFile', buffer, 'preview.jpg');

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post(`/videos/${videoId}/images/preview`, formData, { headers });
    return response.data as BaseNodeResponse;
  }

  public async setPoster(
    jwtToken: string,
    videoId: string,
    buffer: Buffer
  ): Promise<BaseNodeResponse> {
    const formData = new FormData();
    formData.append('posterFile', buffer, 'poster.jpg');

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await client.post(`/videos/${videoId}/images/poster`, formData, { headers });
    return response.data as BaseNodeResponse;
  }

  public async streamVideo(
    jwtToken: string,
    options: StreamVideoOptions
  ): Promise<StreamVideoResponse> {
    const {
      title,
      description,
      tags,
      rtmpPort,
      uuid,
      resolution,
      isRecordingStreamRemotely,
      isRecordingStreamLocally,
      networkAddress,
      videoId,
    } = options;
    return this.postAuthenticated<StreamVideoResponse>(jwtToken, '/streams/start', {
      title,
      description,
      tags,
      rtmpPort,
      uuid,
      resolution,
      isRecordingStreamRemotely,
      isRecordingStreamLocally,
      networkAddress,
      videoId,
    });
  }

  public async setVideoChatSettings(
    jwtToken: string,
    videoId: string,
    isChatHistoryEnabled: boolean,
    chatHistoryLimit: number
  ): Promise<BaseNodeResponse> {
    return this.postAuthenticated<BaseNodeResponse>(jwtToken, `/streams/${videoId}/chat/settings`, {
      isChatHistoryEnabled,
      chatHistoryLimit,
    });
  }

  public async uploadM3u8MasterManifest(
    jwtToken: string,
    videoId: string,
    type: string,
    masterManifest: string
  ): Promise<BaseNodeResponse> {
    const client = await this.getClient();
    const response = await client.post(
      `/videos/${videoId}/adaptive/m3u8/${type}/manifests/masterManifest`,
      {
        masterManifest,
      },
      {
        headers: { Authorization: `Bearer ${jwtToken}` },
      }
    );
    return response.data as BaseNodeResponse;
  }
}
