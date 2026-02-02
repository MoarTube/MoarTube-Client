import type { AxiosInstance } from 'axios';
import axios from 'axios';
import FormData from 'form-data';
import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { Config } from '@/config/index.js';
import type { 
    AuthResponse, 
    NodeSettings, 
    NewContentCounts, 
    Video,
    VideoDataAllResponse
} from '@/types/node-api.js';

/**
 * Service for communicating with the MoarTube Node API
 * Replaces _src/utils/node-communications.js
 */
export class NodeApiService extends BaseService {
  // private readonly settingsRepo: SettingsRepository;
  private readonly config: Config;

  constructor(logger: Logger, config: Config) {
    super('nodeApiService', logger);
    this.config = config;
    // this.settingsRepo = settingsRepository;
  }

  private getBaseUrl(): Promise<string> {
    // We read fresh settings every time to ensure we use valid IP/Port if they change
    const settings = this.config.clientSettings;
    return Promise.resolve(`${settings.nodeHttpProtocol}://${settings.nodeIp}:${String(settings.nodePort)}`);
  }

  private async getClient(): Promise<AxiosInstance> {
    const baseURL = await this.getBaseUrl();
    return axios.create({
      baseURL,
      timeout: 10000,
      validateStatus: () => true // Handle status codes manually
    });
  }

  /**
   * Check if user is authenticated with the Node
   */
  public async isAuthenticated(jwtToken?: string): Promise<AuthResponse> {
    if (!jwtToken) {
      return { isError: false, isAuthenticated: false };
    }

    try {
      const client = await this.getClient();
      const response = await client.get('/account/authenticated', {
        headers: { Authorization: `Bearer ${jwtToken}` }
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
      try {
          const url = `${protocol}://${ip}:${String(port)}/status/heartbeat`;
          const response = await axios.get(url, { timeout: 5000 });
          return response.data;
      } catch (error) {
          throw error;
      }
  }

  /**
   * Sign In
   */
  public async signIn(username: string, password: string, rememberMe: boolean): Promise<AuthResponse> {
    const client = await this.getClient();
    const settings = this.config.clientSettings;
    
    const payload = {
        username,
        password,
        moarTubeNodeHttpProtocol: settings.nodeHttpProtocol,
        moarTubeNodeIp: settings.nodeIp,
        moarTubeNodePort: settings.nodePort,
        rememberMe
    };

    const response = await client.post('/account/signin', payload);
    return response.data as AuthResponse;
  }

  /**
   * Get Videos (Search)
   */
  public async searchVideos(jwtToken: string | undefined, searchTerm: string, sortTerm: string, tagTerm: string, tagLimit: number, timestamp: number): Promise<Video[]> {
      const client = await this.getClient();
      const headers = jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {};
      
      const response = await client.get('/videos/search', {
          params: {
            searchTerm,
            sortTerm,
            tagTerm,
            tagLimit,
            timestamp
          },
          headers
      });

      return response.data as Video[];
  }

  private async postAuthenticated<T = unknown>(jwtToken: string, url: string, data: unknown = {}): Promise<T> {
      const client = await this.getClient();
      const response = await client.post(url, data, {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data as T;
  }

  public async setVideoPublishing(jwtToken: string, videoId: string) {
      return this.postAuthenticated(jwtToken, '/videos/publishing', { videoId });
  }

  public async getExternalVideosBaseUrl(jwtToken: string): Promise<string> {
      const client = await this.getClient();
      const response = await client.get('/external/videos/baseUrl', {
        headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return (response.data as { externalVideosBaseUrl: string }).externalVideosBaseUrl;
  }
  
  public async getNodeSettings(jwtToken: string): Promise<NodeSettings> {
       const client = await this.getClient();
       const response = await client.get('/settings', {
        headers: { Authorization: `Bearer ${jwtToken}` }
       });
       return (response.data as { nodeSettings: NodeSettings }).nodeSettings;
  }

  public async searchVideosAll(searchTerm: string, sortTerm: string, tagTerm: string, tagLimit: number, timestamp: number): Promise<Video[]> {
      const client = await this.getClient();
      const response = await client.get('/node/search', {
          params: { searchTerm, sortTerm, tagTerm, tagLimit, timestamp }
      });
      return response.data as Video[];
  }

  public async getNewContentCounts(jwtToken: string): Promise<{ newContentCounts: NewContentCounts }> {
    const client = await this.getClient();
    const response = await client.get('/node/newContentCounts', {
        headers: { Authorization: `Bearer ${jwtToken}` }
    });
    return response.data as { newContentCounts: NewContentCounts };
  }

  public async setContentChecked(jwtToken: string, contentType: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/node/contentChecked', { contentType });
  }

  public async setVideoFormatResolutionPublished(jwtToken: string, videoId: string, format: string, resolution: string) {
      return this.postAuthenticated(jwtToken, `/videos/${videoId}/published`, { format, resolution });
  }

  public async getVideoDataAll(jwtToken: string): Promise<VideoDataAllResponse> {
    const client = await this.getClient();
    const response = await client.get('/videos/data/all', {
        headers: { Authorization: `Bearer ${jwtToken}` }
    });
    return response.data as VideoDataAllResponse;
  }

  // Settings Methods
  
  public async getAvatar(jwtToken: string): Promise<unknown> {
    const client = await this.getClient();
    const response = await client.get('/settings/avatar', { headers: { Authorization: `Bearer ${jwtToken}` } });
    return response.data;
  }

  public async setAvatar(jwtToken: string, icon: Buffer, avatar: Buffer): Promise<unknown> {
    const formData = new FormData();
    formData.append('iconFile', icon, 'icon.png');
    formData.append('avatarFile', avatar, 'avatar.png');

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers.Authorization = `Bearer ${jwtToken}`;

    const response = await client.post('/settings/avatar', formData, { headers });
    return response.data;
  }

  public async getBanner(jwtToken: string): Promise<unknown> {
    const client = await this.getClient();
    const response = await client.get('/settings/banner', { headers: { Authorization: `Bearer ${jwtToken}` } });
    return response.data;
  }

  public async setBanner(jwtToken: string, banner: Buffer): Promise<unknown> {
    const formData = new FormData();
    formData.append('bannerFile', banner, 'banner.png');

    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers.Authorization = `Bearer ${jwtToken}`;

    const response = await client.post('/settings/banner', formData, { headers });
    return response.data;
  }

  public async setNodeName(jwtToken: string, nodeName: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/personalize/name', { nodeName });
  }

  public async setNodeAbout(jwtToken: string, nodeAbout: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/personalize/about', { nodeAbout });
  }

  public async setNodeId(jwtToken: string, nodeId: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/personalize/id', { nodeId });
  }

  public async setSecureConnection(jwtToken: string, isSecure: boolean, keyFile: any, certFile: any, caFiles: any): Promise<any> {
      const formData = new FormData();

      if (keyFile) {
          formData.append('keyFile', keyFile.buffer, 'private_key.pem');
      }

      if (certFile) {
          formData.append('certFile', certFile.buffer, 'certificate.pem');
      }

      if (caFiles) {
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
      headers.Authorization = `Bearer ${jwtToken}`;

      const response = await client.post('/settings/secure', formData, {
          params: { isSecure }, 
          headers 
      });
      return response.data;
  }

  public async setNetworkInternal(jwtToken: string, nodeListeningPort: number): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/network/internal', { nodeListeningPort });
  }

  public async setExternalNetwork(jwtToken: string, publicNodeProtocol: string, publicNodeAddress: string, publicNodePort: number): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/network/external', { publicNodeProtocol, publicNodeAddress, publicNodePort });
  }

  public async setCloudflareConfiguration(jwtToken: string, email: string, zoneId: string, apiKey: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/cloudflare/configure', { cloudflareEmailAddress: email, cloudflareZoneId: zoneId, cloudflareGlobalApiKey: apiKey });
  }

  public async clearCloudflareConfiguration(jwtToken: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/cloudflare/clear');
  }

  public async setCloudflareTurnstileConfiguration(jwtToken: string, siteKey: string, secretKey: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/cloudflare/turnstile/configure', { cloudflareTurnstileSiteKey: siteKey, cloudflareTurnstileSecretKey: secretKey });
  }

  public async clearCloudflareTurnstileConfiguration(jwtToken: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/cloudflare/turnstile/clear');
  }

  public async databaseConfigToggle(jwtToken: string, databaseConfig: any): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/database/config/toggle', { databaseConfig });
  }

  public async databaseConfigEmpty(jwtToken: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/database/config/empty');
  }

  public async storageConfigToggle(jwtToken: string, storageConfig: any): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/storage/config/toggle', { storageConfig });
  }

  public async storageConfigEmpty(jwtToken: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/storage/config/empty');
  }

  public async commentsToggle(jwtToken: string, isCommentsEnabled: boolean): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/comments/toggle', { isCommentsEnabled });
  }

  public async likesToggle(jwtToken: string, isLikesEnabled: boolean): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/likes/toggle', { isLikesEnabled });
  }

  public async dislikesToggle(jwtToken: string, isDislikesEnabled: boolean): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/dislikes/toggle', { isDislikesEnabled });
  }

  // Links Methods

  public async getLinks(): Promise<any> {
      const client = await this.getClient();
      const response = await client.get('/links/all');
      return response.data;
  }

  public async addLink(jwtToken: string, url: string, svgGraphic: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/links/add', { url, svgGraphic });
  }

  public async deleteLink(jwtToken: string, linkId: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/links/delete', { linkId });
  }

  // Monetization Methods

  public async getMonetizationAll(): Promise<any> {
      const client = await this.getClient();
      const response = await client.get('/monetization/all');
      return response.data;
  }

  public async addMonetizationAddress(jwtToken: string, walletAddress: string, chain: string, currency: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/monetization/add', { walletAddress, chain, currency });
  }

  public async deleteMonetizationAddress(jwtToken: string, cryptoWalletAddressId: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/monetization/delete', { cryptoWalletAddressId });
  }

  // Comments Methods

  public async getVideoComments(jwtToken: string, videoId: string, timestamp: number, type: string, sort: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.get(`/videos/${videoId}/comments`, {
          params: { timestamp, type, sort },
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  public async searchComments(jwtToken: string, videoId: string, searchTerm: string, sortDirection: string, limit: number, timestamp: number): Promise<any> {
      const client = await this.getClient();
      const response = await client.get('/comments/search', {
          params: { videoId, searchTerm, sortDirection, limit, timestamp },
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  public async removeComment(jwtToken: string, videoId: string, commentId: string, timestamp: number): Promise<any> {
      const client = await this.getClient();
      const response = await client.delete(`/videos/${videoId}/comments/${commentId}/delete`, {
          params: { timestamp },
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  // Reports Methods - Videos

  public async getVideoReports(jwtToken: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.get('/reports/videos', {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  public async getVideoReportsArchive(jwtToken: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.get('/reports/archive/videos', {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  public async archiveVideoReport(jwtToken: string, reportId: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/reports/videos/archive', { reportId });
  }

  public async removeVideoReport(jwtToken: string, reportId: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.delete(`/reports/videos/${reportId}/delete`, {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  public async removeVideoReportArchive(jwtToken: string, archiveId: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.delete(`/reports/archive/videos/${archiveId}/delete`, {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  // Reports Methods - Comments

  public async getCommentReports(jwtToken: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.get('/reports/comments', {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  public async getCommentReportsArchive(jwtToken: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.get('/reports/archive/comments', {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  public async archiveCommentReport(jwtToken: string, reportId: string): Promise<any> {
      return this.postAuthenticated(jwtToken, '/reports/comments/archive', { reportId });
  }

  public async removeCommentReport(jwtToken: string, reportId: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.delete(`/reports/comments/${reportId}/delete`, {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }

  public async removeCommentReportArchive(jwtToken: string, archiveId: string): Promise<any> {
      const client = await this.getClient();
      const response = await client.delete(`/reports/archive/comments/${archiveId}/delete`, {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }
  
  public async reportVideosToggle(jwtToken: string, isReportsEnabled: boolean): Promise<any> {
     return this.postAuthenticated(jwtToken, '/settings/reports/toggle', { isReportsEnabled });
  }

  // Videos Methods

  public async getVideosTags(jwtToken: string): Promise<any> {
    const client = await this.getClient();
    const response = await client.get('/videos/tags', { headers: { Authorization: `Bearer ${jwtToken}` } });
    return response.data;
  }

  public async getVideosTagsAll(jwtToken: string): Promise<any> {
    const client = await this.getClient();
    const response = await client.get('/videos/tags/all', { headers: { Authorization: `Bearer ${jwtToken}` } });
    return response.data;
  }

  public async getVideoPublishes(jwtToken: string, videoId: string): Promise<any> {
    const client = await this.getClient();
    const response = await client.get(`/videos/${videoId}/publishes`, { headers: { Authorization: `Bearer ${jwtToken}` } });
    return response.data;
  }

  public async setVideoData(jwtToken: string, videoId: string, title: string, description: string, tags: string): Promise<any> {
    return this.postAuthenticated(jwtToken, `/videos/${videoId}/data`, { title, description, tags });
  }

  public async deleteVideos(jwtToken: string, videoIds: string[]): Promise<any> {
    return this.postAuthenticated(jwtToken, '/videos/delete', { videoIds });
  }

  public async finalizeVideos(jwtToken: string, videoIds: string[]): Promise<any> {
    return this.postAuthenticated(jwtToken, '/videos/finalize', { videoIds });
  }

  public async addVideoToIndex(jwtToken: string, videoId: string, containsAdultContent: boolean, termsOfServiceAgreed: boolean, cloudflareTurnstileToken: string): Promise<any> {
    return this.postAuthenticated(jwtToken, '/videos/index/add', { videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken });
  }

  public async removeVideoFromIndex(jwtToken: string, videoId: string, cloudflareTurnstileToken: string): Promise<any> {
    return this.postAuthenticated(jwtToken, '/videos/index/remove', { videoId, cloudflareTurnstileToken });
  }

  public async setIsIndexOutdated(jwtToken: string, videoId: string): Promise<any> {
    return this.postAuthenticated(jwtToken, `/videos/${videoId}/index/outdated`);
  }

  public async getVideoPermissions(jwtToken: string, videoId: string): Promise<any> {
    const client = await this.getClient();
    const response = await client.get(`/videos/${videoId}/permissions`, { headers: { Authorization: `Bearer ${jwtToken}` } });
    return response.data;
  }

  public async postVideoPermissions(jwtToken: string, videoId: string, type: string, isEnabled: boolean): Promise<any> {
    return this.postAuthenticated(jwtToken, `/videos/${videoId}/permissions`, { type, isEnabled });
  }

  public async getVideoSources(videoId: string): Promise<any> {
      const client = await this.getClient();
      // This endpoint might be checking the node directly? 
      // Legacy used node_getVideoSources without token? 
      // Let's check legacy definition.
      // node_getVideoSources implementation:
      // axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/sources')
      const response = await client.get(`/videos/${videoId}/sources`);
      return response.data;
  }


  public async liveChatToggle(jwtToken: string, isLiveChatEnabled: boolean): Promise<any> {
      return this.postAuthenticated(jwtToken, '/settings/live-chat/toggle', { isLiveChatEnabled });
  }


  public async setSourceFileExtension(jwtToken: string, videoId: string, extension: string): Promise<unknown> {
       return this.postAuthenticated(jwtToken, `/videos/${videoId}/sourceFileExtension`, { sourceFileExtension: extension });
  }

  public async setVideoImported(jwtToken: string, videoId: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, '/videos/imported', { videoId });
  }
  
  public async stopVideoImporting(jwtToken: string, videoId: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, `/videos/${videoId}/importing/stop`, { videoId });
  }
  
  public async stopVideoPublishing(jwtToken: string, videoId: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, `/videos/${videoId}/publishing/stop`, { videoId });
  }

  public async unpublishVideo(jwtToken: string, videoId: string, format: string, resolution: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, `/videos/${videoId}/unpublish`, { format, resolution });
  }

  public async getVideoData(jwtToken: string | undefined, videoId: string): Promise<any> {
      const client = await this.getClient();
      // Legacy behavior: GET /videos/:videoId/data
      const response = await client.get(`/videos/${videoId}/data`); 
      return response.data;
  }

  public async getSourceFileExtension(jwtToken: string, videoId: string): Promise<unknown> {
     const client = await this.getClient();
     const response = await client.get(`/videos/${videoId}/sourceFileExtension`, {
         headers: { Authorization: `Bearer ${jwtToken}` }
     });
     return response.data;
  }

  public async setVideoPublished(jwtToken: string, videoId: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, '/videos/published', { videoId });
  }

  public uploadVideo(
    _jwtToken: string, _videoId: string, _format: string, _resolution: string,
    _files: Array<{ fileName: string, filePath: string, contentType: string }>
  ): Promise<unknown> {
    // Placeholder for multipart upload
    return Promise.resolve({ isError: false }); 
  }

  public async setVideoLengths(jwtToken: string, videoId: string, lengthSeconds: number, lengthTimestamp: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, '/video/set-lengths', { videoId, lengthSeconds, lengthTimestamp });
  }

  public uploadStream(_jwtToken: string, _videoId: string, _format: string, _resolution: string, _manifestBuffer: Buffer, _segmentBuffer: Buffer, _manifestFileName: string, _segmentFileName: string): Promise<unknown> {
       // Placeholder
       return Promise.resolve({ isError: false });
  }

  public async removeAdaptiveStreamSegment(jwtToken: string, videoId: string, format: string, resolution: string, segmentName: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, '/video/remove-adaptive-stream-segment', { videoId, format, resolution, segmentName });
  }
  
  public async getVideoBandwidth(jwtToken: string, videoId: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, '/video/get-bandwidth', { videoId });
  }

  public async stopVideoStreaming(jwtToken: string, videoId: string): Promise<unknown> {
      return this.postAuthenticated(jwtToken, '/video/stop-streaming', { videoId });
  }

  public async setThumbnail(jwtToken: string, videoId: string, buffer: Buffer): Promise<any> {
    const formData = new FormData();
    formData.append('thumbnailFile', buffer, 'thumbnail.jpg');
    
    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers.Authorization = `Bearer ${jwtToken}`;

    const response = await client.post(`/videos/${videoId}/images/thumbnail`, formData, { headers });
    return response.data;
  }

  public async setPreview(jwtToken: string, videoId: string, buffer: Buffer): Promise<any> {
    const formData = new FormData();
    formData.append('previewFile', buffer, 'preview.jpg');
    
    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers.Authorization = `Bearer ${jwtToken}`;

    const response = await client.post(`/videos/${videoId}/images/preview`, formData, { headers });
    return response.data;
  }

  public async setPoster(jwtToken: string, videoId: string, buffer: Buffer): Promise<any> {
    const formData = new FormData();
    formData.append('posterFile', buffer, 'poster.jpg');
    
    const client = await this.getClient();
    const headers = formData.getHeaders();
    headers.Authorization = `Bearer ${jwtToken}`;

    const response = await client.post(`/videos/${videoId}/images/poster`, formData, { headers });
    return response.data;
  }

  public async streamVideo(
    jwtToken: string,
    title: string, description: string, tags: string, resolution: string,
    isRecordingStreamRemotely: boolean, isRecordingStreamLocally: boolean,
    networkAddress: string, videoId?: string
  ): Promise<unknown> {
      return this.postAuthenticated(jwtToken, '/video/stream', {
          title, description, tags, resolution,
          isRecordingStreamRemotely, isRecordingStreamLocally,
          networkAddress, videoId
      });
  }

  public async setVideoChatSettings(jwtToken: string, videoId: string, isChatHistoryEnabled: boolean, chatHistoryLimit: number): Promise<unknown> {
      return this.postAuthenticated(jwtToken, '/video/set-chat-settings', { videoId, isChatHistoryEnabled, chatHistoryLimit });
  }

  public async uploadM3u8MasterManifest(jwtToken: string, videoId: string, type: string, masterManifest: string): Promise<unknown> {
      const client = await this.getClient();
      const response = await client.post(`/videos/${videoId}/adaptive/m3u8/${type}/manifests/masterManifest`, {
          masterManifest
      }, {
          headers: { Authorization: `Bearer ${jwtToken}` }
      });
      return response.data;
  }
}
