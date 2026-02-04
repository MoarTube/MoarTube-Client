import type { FastifyReply, FastifyRequest } from 'fastify';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BaseController } from './base.js';
import type { NodeApiService } from '@/services/node-api.js';
import type { VideoImportService } from '@/services/video-import.js';
import type { VideoPublishService } from '@/services/video-publish.js';
import type { SettingsRepository } from '@/database/repositories/settings.js';
import type { ManifestService } from '@/services/manifest.js';
import type { S3Service } from '@/services/s3.js';
import type { SocketService } from '@/services/socket.js';
import type {
    VideoSearchQuery,
    VideoIdParams,
    StopImportBody,
    PublishBody,
    StopPublishBody,
    UnpublishBody,
    VideoDataBody,
    AddToIndexBody,
    RemoveFromIndexBody,
    VideoPermissionsBody,
    DeleteVideosBody,
    FinalizeVideosBody
} from '@/types/requests.js';

export class VideosController extends BaseController {
    constructor(
        private readonly nodeApiService: NodeApiService,
        private readonly videoImportService: VideoImportService,
        private readonly videoPublishService: VideoPublishService,
        private readonly settingsRepository: SettingsRepository,
        private readonly manifestService: ManifestService,
        private readonly s3Service: S3Service,
        private readonly socketService: SocketService
    ) {
        super('VideosController');
    }

    public getRoot = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';

            // Check authentication
            const check = await this.nodeApiService.isAuthenticated(jwtToken);
            if (!check.isAuthenticated) {
                return await reply.redirect('/account/signin');
            }

            if (check.isError) {
                 // In legacy, if error, it signs out.
                 await request.session.destroy();
                 return await reply.redirect('/account/signin');
            }

            // Fetch data
            const [nodeSettings, newContentCounts, externalVideosBaseUrl] = await Promise.all([
                 this.nodeApiService.getNodeSettings(jwtToken),
                 this.nodeApiService.getNewContentCounts(jwtToken).then(res => res.newContentCounts),
                 this.nodeApiService.getExternalVideosBaseUrl(jwtToken)
            ]);

            return await reply.view('videos', {
                model: {
                    nodeSettings,
                    newContentCounts,
                    externalVideosBaseUrl
                }
            });

        } catch (error) {
            this.logger.error('Error in getRoot', error);
             // In legacy, on error also signs out? "node_doSignout(req, res);"
             await request.session.destroy();
             return await reply.redirect('/account/signin');
        }
    }

    // View: GET /videos/search
    public getSearch = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
             const jwtToken = request.session.jwtToken ?? '';
             const query = request.query as VideoSearchQuery;

             const data = await this.nodeApiService.searchVideos(
                 jwtToken,
                 query.searchTerm ?? '',
                 query.sortTerm ?? '',
                 query.tagTerm ?? '',
                 query.tagLimit ?? 0,
                 query.timestamp ?? 0
             );

             return await reply.send(data);
        } catch (error) {
             this.logger.error('Error in getSearch', error);
             return await this.sendError(reply, 'error communicating with the MoarTube node');
        }
    }
    public postImport = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            
            const { videoId, tempFilePath, fileMimeType } = await this.handleImportMultipart(request);

            if (videoId === undefined || tempFilePath === undefined) {
                if (tempFilePath !== undefined && fs.existsSync(tempFilePath)) {
                    await fs.promises.unlink(tempFilePath);
                }
                return await this.sendError(reply, 'Missing videoId or videoFile');
            }

            // Move to correct source location
            const videosDir = this.settingsRepository.getVideosDirectoryPath();
            const videoSourceDir = path.join(videosDir, videoId, 'source');
            await fs.promises.mkdir(videoSourceDir, { recursive: true });

            let ext = path.extname(tempFilePath);
            if (ext === '' && fileMimeType !== undefined) {
                 if (fileMimeType === 'video/mp4') {ext = '.mp4';}
                 else if (fileMimeType === 'video/webm') {ext = '.webm';}
            }
            
            const destPath = path.join(videoSourceDir, videoId + ext);
            await fs.promises.rename(tempFilePath, destPath);

            // Trigger Import Service
            // We mock the "file" object expected by service
            const fileObj = {
                path: destPath,
                mimetype: fileMimeType ?? 'application/octet-stream' // Should be detected
            };

            const result = await this.videoImportService.importVideo(jwtToken, videoId, fileObj);
            
            return await reply.send(result);
        } catch (error) {
            this.logger.error('Error in postImport', error);
            return await this.sendError(reply, 'Upload failed');
        }
    }

    private async handleImportMultipart(request: FastifyRequest): Promise<{ videoId: string | undefined; tempFilePath: string | undefined; fileMimeType: string | undefined }> {
         const parts = request.parts();
         let videoId: string | undefined;
         let tempFilePath: string | undefined;
         let fileMimeType: string | undefined;

         for await (const part of parts) {
            if (part.type === 'file') {
                if (part.fieldname === 'videoFile') {
                     const tempDir = this.settingsRepository.getTempDirectoryPath();
                     tempFilePath = path.join(tempDir, part.filename);
                     fileMimeType = part.mimetype;
                     await pipeline(part.file, fs.createWriteStream(tempFilePath));
                } else {
                     part.file.resume();
                }
            } else if (part.fieldname === 'videoId') {
                videoId = (part.value as string);
            }
         }
         return { videoId, tempFilePath, fileMimeType };
    }

    public postStopImport = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
         try {
             const jwtToken = request.session.jwtToken ?? '';
             const { videoId } = request.body as StopImportBody;
             const result = await this.videoImportService.stopImporting(jwtToken, videoId);
             return await reply.send(result);
         } catch(error) {
             this.logger.error('Error in postStopImport', error);
             return await this.sendError(reply, 'Stop import failed');
         }
    }

    public postPublish = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId, publishings: publishingsStr } = request.body as PublishBody;
            const publishings = JSON.parse(publishingsStr) as { format: string, resolution: string }[];

            const response1 = await this.nodeApiService.getVideoData(jwtToken, videoId);
            if (response1.isError) {
                 return await reply.send(response1);
            }

            const { isLive, isStreaming, isFinalized } = response1.videoData;
            if (isLive && isStreaming) {
                return await this.sendError(reply, 'this video is currently streaming');
            }
            if (isFinalized) {
                return await this.sendError(reply, 'this video was finalized; no further publishings are possible');
            }

            const response2 = await this.nodeApiService.getSourceFileExtension(jwtToken, videoId);
            if (response2.isError) {
                return await reply.send(response2);
            }
            
            const sourceFileExtension = response2.sourceFileExtension;
            const sourceFilePath = path.join(this.settingsRepository.getVideosDirectoryPath(), videoId, 'source', videoId + sourceFileExtension);

            if (fs.existsSync(sourceFilePath)) {
                 for (const publishing of publishings) {
                      this.videoPublishService.enqueuePendingPublishVideo({
                          jwtToken,
                          videoId,
                          format: publishing.format as 'm3u8' | 'mp4' | 'webm' | 'ogv',
                          resolution: publishing.resolution,
                          sourceFileExtension
                      });
                 }
                 return await this.sendSuccess(reply, {});
            } else {
                 if (isLive) {
                     return await this.sendError(reply, 'a recording of this stream does not exist<br>record your streams locally for later publishing');
                 }
                 return await this.sendError(reply, 'source file not found');
            }

        } catch (error) {
             this.logger.error('Error in postPublish', error);
             return await this.sendError(reply, 'Publish request failed');
        }
    }

    public postStopPublish = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
             const jwtToken = request.session.jwtToken ?? '';
             const { videoId } = request.body as StopPublishBody;
             
             // Stop local
             this.videoPublishService.stopPendingPublishVideo(videoId);
             
             // Tell node
             const response = await this.nodeApiService.stopVideoPublishing(jwtToken, videoId);
             return await reply.send(response);
        } catch(error) {
             this.logger.error('Error in postStopPublish', error);
             return await this.sendError(reply, 'Stop publish failed');
        }
    }

    public postUnpublish = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId, format, resolution } = request.body as UnpublishBody;

            const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
            const storageConfig = nodeSettings.storageConfig;

            const response = await this.nodeApiService.unpublishVideo(jwtToken, videoId, format, resolution);
            if (response.isError) {
                return await reply.send(response);
            }

            if (storageConfig?.storageMode === 's3provider' && storageConfig.s3Config) {
                const s3Config = storageConfig.s3Config;
                if (format === 'm3u8') {
                    const segmentsPrefix = `external/videos/${videoId}/adaptive/m3u8/${resolution}`;
                    const manifestKey = `external/videos/${videoId}/adaptive/m3u8/static/manifests/manifest-${resolution}.m3u8`;
                    
                    await this.s3Service.deleteDirectoryRecursive(s3Config, segmentsPrefix);
                    await this.s3Service.deleteObjectWithKey(s3Config, manifestKey);
                } else if (['mp4', 'webm', 'ogv'].includes(format)) {
                     const key = `external/videos/${videoId}/progressive/${format}/${resolution}.${format}`;
                     await this.s3Service.deleteObjectWithKey(s3Config, key);
                }
            }

            if (format === 'm3u8') {
                await this.manifestService.refreshMasterManifest(jwtToken, videoId);
            }

            return await this.sendSuccess(reply, {});
        } catch (error) {
            this.logger.error('Error in postUnpublish', error);
            return await this.sendError(reply, 'Unpublish failed');
        }
    }

    public getTags = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const response = await this.nodeApiService.getVideosTags(jwtToken);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in getTags', error);
            return await this.sendError(reply, 'Failed to get tags');
        }
    }

    public getAllTags = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const response = await this.nodeApiService.getVideosTagsAll(jwtToken);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in getAllTags', error);
            return await this.sendError(reply, 'Failed to get all tags');
        }
    }

    public getVideoPublishes = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId } = request.params as VideoIdParams;
            const response = await this.nodeApiService.getVideoPublishes(jwtToken, videoId);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in getVideoPublishes', error);
            return await this.sendError(reply, 'Failed to get video publishes');
        }
    }

    public getVideoData = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId } = request.params as VideoIdParams;
            const response = await this.nodeApiService.getVideoData(jwtToken, videoId);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in getVideoData', error);
            return await this.sendError(reply, 'Failed to get video data');
        }
    }

    public postVideoData = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId, title, description, tags } = request.body as VideoDataBody;
            const response = await this.nodeApiService.setVideoData(jwtToken, videoId, title, description, tags);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in postVideoData', error);
            return await this.sendError(reply, 'Failed to update video data');
        }
    }

    public postAddToIndex = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken } = request.body as AddToIndexBody;
            const response = await this.nodeApiService.addVideoToIndex(jwtToken, videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in postAddToIndex', error);
            return await this.sendError(reply, 'Failed to add to index');
        }
    }

    public postRemoveFromIndex = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId, cloudflareTurnstileToken } = request.body as RemoveFromIndexBody;
            const response = await this.nodeApiService.removeVideoFromIndex(jwtToken, videoId, cloudflareTurnstileToken);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in postRemoveFromIndex', error);
            return await this.sendError(reply, 'Failed to remove from index');
        }
    }

    public getVideoPermissions = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId } = request.params as VideoIdParams;
            const response = await this.nodeApiService.getVideoPermissions(jwtToken, videoId);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in getVideoPermissions', error);
            return await this.sendError(reply, 'Failed to get permissions');
        }
    }

    public postVideoPermissions = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId, type, isEnabled } = request.body as VideoPermissionsBody;
            const response = await this.nodeApiService.postVideoPermissions(jwtToken, videoId, type, isEnabled);
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in postVideoPermissions', error);
            return await this.sendError(reply, 'Failed to set permissions');
        }
    }

    public getVideoSources = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const { videoId } = request.params as VideoIdParams;
            
            const response = await this.nodeApiService.getVideoSources(videoId);
            if (!response.isError) {
                const { adaptiveSources, progressiveSources } = response.video;
                return await this.sendSuccess(reply, { sources: { adaptiveSources, progressiveSources } });
            }
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in getVideoSources', error);
            return await this.sendError(reply, 'Failed to get sources');
        }
    }

    public postDelete = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoIds } = request.body as DeleteVideosBody;

            const nodeResponse = await this.nodeApiService.deleteVideos(jwtToken, videoIds);
            const { deletedVideoIds, nonDeletedVideoIds } = nodeResponse;

            for (const deletedVideoId of deletedVideoIds) {
                 const videoPath = path.join(this.settingsRepository.getVideosDirectoryPath(), deletedVideoId);
                 await fs.promises.rm(videoPath, { recursive: true, force: true });
            }

            const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
            const storageConfig = nodeSettings.storageConfig;

            if (storageConfig?.storageMode === 's3provider' && storageConfig.s3Config) {
                for (const videoId of videoIds) {
                     const videoPrefix = `external/videos/${videoId}`;
                     await this.s3Service.deleteDirectoryRecursive(storageConfig.s3Config, videoPrefix);
                }
            }

            return await reply.send({ isError: false, deletedVideoIds, nonDeletedVideoIds });

        } catch (error) {
            this.logger.error('Error in postDelete', error);
            return await this.sendError(reply, 'Failed to delete videos');
        }
    }

    public postFinalize = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoIds } = request.body as FinalizeVideosBody;

            const response = await this.nodeApiService.finalizeVideos(jwtToken, videoIds);

            if (!response.isError) {
                const { finalizedVideoIds, nonFinalizedVideoIds } = response;
                for (const finalizedVideoId of finalizedVideoIds) {
                    const videoDirectory = path.join(this.settingsRepository.getVideosDirectoryPath(), finalizedVideoId);
                    await fs.promises.rm(videoDirectory, { recursive: true, force: true });
                    
                    this.socketService.broadcastToUser(jwtToken, 'echo', { 
                        eventName: 'video_status', 
                        payload: { type: 'finalized', videoId: finalizedVideoId } 
                    });
                }
                return await reply.send({ isError: false, finalizedVideoIds, nonFinalizedVideoIds });
            }
            return await reply.send(response);
        } catch (error) {
            this.logger.error('Error in postFinalize', error);
            return await this.sendError(reply, 'Failed to finalize videos');
        }
    }

    public postThumbnail = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId } = request.params as VideoIdParams;
            const data = await request.file();

            if (!data) {
                return await this.sendError(reply, 'Thumbnail file is missing');
            }

            const buffer = await data.toBuffer();
             // Resize
            const thumbnailBuffer = await sharp(buffer)
                .resize({ width: 100 })
                .resize(100, 100)
                .jpeg({ quality: 90 })
                .toBuffer();

            const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
            const storageConfig = nodeSettings.storageConfig;

            if (storageConfig?.storageMode === 'filesystem') {
                await this.nodeApiService.setThumbnail(jwtToken, videoId, thumbnailBuffer);
            } else if (storageConfig?.storageMode === 's3provider' && storageConfig.s3Config) {
                const s3Config = storageConfig.s3Config;
                const key = `external/videos/${videoId}/images/thumbnail.jpg`;
                await this.s3Service.putObjectFromData(s3Config, key, thumbnailBuffer, 'image/jpeg');
                await this.nodeApiService.setIsIndexOutdated(jwtToken, videoId);
            }

            return await this.sendSuccess(reply, {});

        } catch (error) {
            this.logger.error('Error in postThumbnail', error);
            return await this.sendError(reply, 'Failed to upload thumbnail');
        }
    }

    public postPreview = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId } = request.params as VideoIdParams;
            const data = await request.file();

            if (!data) {
                return await this.sendError(reply, 'Preview file is missing');
            }

            const buffer = await data.toBuffer();
             // Resize
            const previewBuffer = await sharp(buffer)
                .resize({ width: 512 })
                .resize(512, 288)
                .jpeg({ quality: 90 })
                .toBuffer();

            const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
            const storageConfig = nodeSettings.storageConfig;

            if (storageConfig?.storageMode === 'filesystem') {
                await this.nodeApiService.setPreview(jwtToken, videoId, previewBuffer);
            } else if (storageConfig?.storageMode === 's3provider' && storageConfig.s3Config) {
                const s3Config = storageConfig.s3Config;
                const key = `external/videos/${videoId}/images/preview.jpg`;
                await this.s3Service.putObjectFromData(s3Config, key, previewBuffer, 'image/jpeg');
                await this.nodeApiService.setIsIndexOutdated(jwtToken, videoId);
            }

            return await this.sendSuccess(reply, {});

        } catch (error) {
            this.logger.error('Error in postPreview', error);
            return await this.sendError(reply, 'Failed to upload preview');
        }
    }

    public postPoster = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        try {
            const jwtToken = request.session.jwtToken ?? '';
            const { videoId } = request.params as VideoIdParams;
            const data = await request.file();

            if (!data) {
                return await this.sendError(reply, 'Poster file is missing');
            }

            const buffer = await data.toBuffer();
             // Resize
            const posterBuffer = await sharp(buffer)
                .resize({ width: 1280 })
                .resize(1280, 720)
                .jpeg({ quality: 90 })
                .toBuffer();

            const nodeSettings = await this.nodeApiService.getNodeSettings(jwtToken);
            const storageConfig = nodeSettings.storageConfig;

            if (storageConfig?.storageMode === 'filesystem') {
                await this.nodeApiService.setPoster(jwtToken, videoId, posterBuffer);
            } else if (storageConfig?.storageMode === 's3provider' && storageConfig.s3Config) {
                const s3Config = storageConfig.s3Config;
                const key = `external/videos/${videoId}/images/poster.jpg`;
                await this.s3Service.putObjectFromData(s3Config, key, posterBuffer, 'image/jpeg');
                await this.nodeApiService.setIsIndexOutdated(jwtToken, videoId);
            }

            return await this.sendSuccess(reply, {});

        } catch (error) {
            this.logger.error('Error in postPoster', error);
            return await this.sendError(reply, 'Failed to upload poster');
        }
    }
}

