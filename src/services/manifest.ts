import { requireNodeSuccess } from '@/utils/node-actions.js';
import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { NodeApiService } from './node-api.js';
import type { S3Service } from './s3.js';

export class ManifestService extends BaseService {
  constructor(
    logger: Logger,
    private readonly nodeApiService: NodeApiService,
    s3Service: S3Service
  ) {
    super('manifestService', logger);
    void s3Service; // Retain constructor compatibility; Node now owns all master writes.
  }

  public async refreshMasterManifest(jwtToken: string, videoId: string): Promise<void> {
    try {
      const responseProxy = await this.nodeApiService.getVideoData(jwtToken, videoId);
      if (responseProxy.isError) {
        this.logger.error(
          `Failed to get video data for ${videoId}: ${responseProxy.message ?? ''}`
        );
        throw new Error(responseProxy.message ?? 'Cannot refresh master manifest');
      }
      const videoData = responseProxy.videoData;

      const isStreaming = videoData.isStreaming;
      const resolutions = videoData.outputs?.m3u8 ?? [];

      const externalVideosBaseUrl = await this.nodeApiService.getExternalVideosBaseUrl(jwtToken);
      const manifestType = isStreaming ? 'dynamic' : 'static';

      let masterManifest = '#EXTM3U\n#EXT-X-VERSION:3\n';

      for (const resolution of resolutions) {
        if (resolution === '240p') {
          masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=426x240\n';
          masterManifest += `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${manifestType}/manifests/manifest-240p.m3u8\n`;
        } else if (resolution === '360p') {
          masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\n';
          masterManifest += `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${manifestType}/manifests/manifest-360p.m3u8\n`;
        } else if (resolution === '480p') {
          masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\n';
          masterManifest += `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${manifestType}/manifests/manifest-480p.m3u8\n`;
        } else if (resolution === '720p') {
          masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n';
          masterManifest += `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${manifestType}/manifests/manifest-720p.m3u8\n`;
        } else if (resolution === '1080p') {
          masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\n';
          masterManifest += `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${manifestType}/manifests/manifest-1080p.m3u8\n`;
        } else if (resolution === '1440p') {
          masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=2560x1440\n';
          masterManifest += `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${manifestType}/manifests/manifest-1440p.m3u8\n`;
        } else if (resolution === '2160p') {
          masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=16000000,RESOLUTION=3840x2160\n';
          masterManifest += `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${manifestType}/manifests/manifest-2160p.m3u8\n`;
        }
      }

      requireNodeSuccess(
        await this.nodeApiService.uploadM3u8MasterManifest(
          jwtToken,
          videoId,
          manifestType,
          masterManifest
        )
      );
    } catch (error) {
      this.logger.error(`Error refreshing master manifest for ${videoId}`, error);
      throw error;
    }
  }
}
