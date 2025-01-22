const path = require('path');
const fs = require('fs');
const spawnSync = require('child_process').spawnSync;
const sharp = require('sharp');

sharp.cache(false);

const { 
    logDebugMessageToConsole, deleteDirectoryRecursive, getVideosDirectoryPath, timestampToSeconds, websocketClientBroadcast, getFfmpegPath,
    refreshM3u8MasterManifest, getNodeSettings
} = require('../utils/helpers');
const { 
    node_stopVideoImporting, node_doVideosSearch, node_getVideoData, node_unpublishVideo, node_stopVideoPublishing,
    node_setSourceFileExtension, node_setThumbnail, node_setPreview, node_setPoster, node_setVideoLengths, node_setVideoImported, node_getVideosTags, node_getSourceFileExtension, 
    node_getVideosTagsAll, node_getVideoPublishes, node_setVideoData, node_deleteVideos, node_finalizeVideos, node_addVideoToIndex, node_removeVideoFromIndex, node_getVideoSources
} = require('../utils/node-communications');
const {
    s3_putObjectFromData, s3_deleteObjectsWithPrefix, s3_deleteObjectWithKey
} = require('../utils/s3-communications');
const { 
    enqueuePendingPublishVideo 
} = require('../utils/trackers/pending-publish-video-tracker');

async function search_GET(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    const response = await node_doVideosSearch(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp);

    return response;
}

async function import_POST(jwtToken, videoFile, videoId) {
    let result;

    if(videoFile != null && videoFile.length === 1) {
        videoFile = videoFile[0];

        const videoFilePath = videoFile.path;
        const mimetype = videoFile.mimetype;

        let sourceFileExtension;
        if(mimetype === 'video/mp4') {
            sourceFileExtension = '.mp4';
        }
        else if(mimetype === 'video/webm') {
            sourceFileExtension = '.webm';
        }
        else {
            throw new Error('unexpected source file: ' + sourceFileExtension);
        }

        const output = spawnSync(getFfmpegPath(), ['-i', videoFilePath], { encoding: 'utf-8' });
        
        const durationIndex = output.stderr.indexOf('Duration: ');
        const lengthTimestamp = output.stderr.substr(durationIndex + 10, 11);
        const lengthSeconds = timestampToSeconds(lengthTimestamp);
        const imageExtractionTimestamp = Math.floor(lengthSeconds * 0.25);

        logDebugMessageToConsole('uploading video length to node for video: ' + videoId, null, null);
        await node_setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp);
        logDebugMessageToConsole('uploaded video length to node for video: ' + videoId, null, null);

        logDebugMessageToConsole('setting source file extension for video: ' + videoId, null, null);
        await node_setSourceFileExtension(jwtToken, videoId, sourceFileExtension);
        logDebugMessageToConsole('set source file extension for video: ' + videoId, null, null);
        
        logDebugMessageToConsole('generating images for video: ' + videoId, null, null);
                        
        const imagesDirectoryPath = path.join(getVideosDirectoryPath(), videoId + '/images');
        
        fs.mkdirSync(imagesDirectoryPath, { recursive: true });

        const sourceImagePath = path.join(imagesDirectoryPath, 'source.jpg');
        
        spawnSync(getFfmpegPath(), ['-ss', imageExtractionTimestamp, '-i', videoFilePath, sourceImagePath]);

        logDebugMessageToConsole('generating thumbnail, preview, and poster for video: ' + videoId, null, null);
        const thumbnailBuffer = await sharp(sourceImagePath).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toBuffer();
        const previewFileBuffer = await sharp(sourceImagePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toBuffer();
        const posterFileBuffer = await sharp(sourceImagePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toBuffer();
        logDebugMessageToConsole('generated thumbnail, preview, and poster for video: ' + videoId, null, null);

        const nodeSettings = await getNodeSettings(jwtToken);

        const storageConfig = nodeSettings.storageConfig;
        const storageMode = storageConfig.storageMode;

        logDebugMessageToConsole('uploading thumbnail, preview, and poster for video: ' + videoId, null, null);

        if(storageMode === 'filesystem') {
            await node_setThumbnail(jwtToken, videoId, thumbnailBuffer);
            logDebugMessageToConsole('uploaded thumbnail to node for video: ' + videoId, null, null);

            await node_setPreview(jwtToken, videoId, previewFileBuffer);
            logDebugMessageToConsole('uploaded preview to node for video: ' + videoId, null, null);

            await node_setPoster(jwtToken, videoId, posterFileBuffer);
            logDebugMessageToConsole('uploaded poster to node for video: ' + videoId, null, null);
        }
        else if(storageMode === 's3provider') {
            const s3Config = storageConfig.s3Config;

            const thumbnailImageKey = 'external/videos/' + videoId + '/images/thumbnail.jpg';
            const previewImageKey = 'external/videos/' + videoId + '/images/preview.jpg';
            const posterImageKey = 'external/videos/' + videoId + '/images/poster.jpg';

            await s3_putObjectFromData(s3Config, thumbnailImageKey, thumbnailBuffer, 'image/jpeg');
            await s3_putObjectFromData(s3Config, previewImageKey, previewFileBuffer, 'image/jpeg');
            await s3_putObjectFromData(s3Config, posterImageKey, posterFileBuffer, 'image/jpeg');
        }

        await deleteDirectoryRecursive(imagesDirectoryPath);

        await node_setVideoImported(jwtToken, videoId);

        logDebugMessageToConsole('flagging video as imported to node for video: ' + videoId, null, null);
        
        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'imported', videoId: videoId, lengthTimestamp: lengthTimestamp }}});
        
        result = {isError: false};
    }
    else {
        result = {isError: true, message: 'video file is missing'};
    }

    return result;
}

async function videoIdImportingStop_POST(jwtToken, videoId) {
    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing_stopping', videoId: videoId }}});

    const response = await node_stopVideoImporting(jwtToken, videoId);

    if(!response.isError) {
        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing_stopped', videoId: videoId }}});
    }

    return response;
}

async function videoIdPublishingStop_POST(jwtToken, videoId) {
    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing_stopping', videoId: videoId }}});
    
    const response = await node_stopVideoPublishing(jwtToken, videoId);

    if(!response.isError) {
        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing_stopped', videoId: videoId }}});
    }

    return response;
}

async function videoIdPublish_POST(jwtToken, videoId, publishings) {
    let result;

    publishings = JSON.parse(publishings);

    const response1 = await node_getVideoData(videoId);

    if(!response1.isError) {
        const isLive = response1.videoData.isLive;
        const isStreaming = response1.videoData.isStreaming;
        const isFinalized = response1.videoData.isFinalized;
        
        if(isLive && isStreaming) {
            result = {isError: true, message: 'this video is currently streaming'};
        }
        else if(isFinalized) {
            result = {isError: true, message: 'this video was finalized; no further publishings are possible'};
        }
        else {
            const response2 = await node_getSourceFileExtension(jwtToken, videoId);

            if(!response2.isError) {
                const sourceFileExtension = response2.sourceFileExtension;
                
                const sourceFilePath = path.join(getVideosDirectoryPath(), videoId + '/source/' + videoId + sourceFileExtension);

                if(fs.existsSync(sourceFilePath)) {
                    for(const publishing of publishings) {
                        const format = publishing.format;
                        const resolution = publishing.resolution;

                        enqueuePendingPublishVideo({
                            jwtToken: jwtToken,
                            videoId: videoId,
                            format: format,
                            resolution: resolution,
                            sourceFileExtension: sourceFileExtension,
                            idleInterval: setInterval(function() {
                                websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing', videoId: videoId, format: format, resolution: resolution, progress: 0 }}});
                            }, 1000)
                        });
                    }
                    
                    result = {isError: false};
                }
                else {
                    if(isLive) {
                        result = {isError: true, message: 'a recording of this stream does not exist<br>record your streams locally for later publishing'};
                    }
                    else {
                        result = {isError: true, message: 'a source for this video does not exist'};
                    }
                }
            }
            else {
                result = response2;
            }
        }
    }
    else {
        result = response1;
    }

    return result;
}

async function videoIdUnpublish_POST(jwtToken, videoId, format, resolution) {
    const nodeSettings = await getNodeSettings(jwtToken);
    const storageConfig = nodeSettings.storageConfig;

    await node_unpublishVideo(jwtToken, videoId, format, resolution);

    if(storageConfig.storageMode === 's3provider') {
        const s3Config = storageConfig.s3Config;

        if(format === 'm3u8') {
            const segmentsPrefix = 'external/videos/' + videoId + '/adaptive/m3u8/' + resolution;
            const manifestKey = 'external/videos/' + videoId + '/adaptive/m3u8/static/manifests/manifest-' + resolution + '.m3u8';

            await s3_deleteObjectsWithPrefix(s3Config, segmentsPrefix);
            await s3_deleteObjectWithKey(s3Config, manifestKey);
        }
        else if(format === 'mp4' || format === 'webm' || format === 'ogv') {
            const key = 'external/videos/' + videoId + '/progressive/' + format + '/' + resolution + '.' + format;

            await s3_deleteObjectWithKey(s3Config, key);
        }
    }

    if(format === 'm3u8') {
        await refreshM3u8MasterManifest(jwtToken, videoId);
    }

    return {isError: false};
}

async function tags_GET(jwtToken) {
    const response = await node_getVideosTags(jwtToken);

    return response;
}

async function tagsAll_GET(jwtToken) {
    const response = await node_getVideosTagsAll(jwtToken);

    return response;
}

async function videoIdPublishes_GET(jwtToken, videoId) {
    const response = await node_getVideoPublishes(jwtToken, videoId);

    return response;
}

async function videoIdData_GET(videoId) {
    const response = await node_getVideoData(videoId);

    return response;
}

async function videoIdData_POST(jwtToken, videoId, title, description, tags) {
    const response = await node_setVideoData(jwtToken, videoId, title, description, tags);

    return response;
}

async function delete_POST(jwtToken, videoIds) {
    const nodeResponseData = await node_deleteVideos(jwtToken, videoIds);

    const deletedVideoIds = nodeResponseData.deletedVideoIds;
    const nonDeletedVideoIds = nodeResponseData.nonDeletedVideoIds;

    for(const deletedVideoId of deletedVideoIds) {
        const deletedVideoIdPath = path.join(getVideosDirectoryPath(), deletedVideoId);
        
        await deleteDirectoryRecursive(deletedVideoIdPath);
    }

    const nodeSettings = await getNodeSettings(jwtToken);
    const storageConfig = nodeSettings.storageConfig;

    if(storageConfig.storageMode === 's3provider') {
        const s3Config = storageConfig.s3Config;

        for(const videoId of videoIds) {
            const videoPrefix = 'external/videos/' + videoId;

            await s3_deleteObjectsWithPrefix(s3Config, videoPrefix);
        }
    }

    return {isError: false, deletedVideoIds: deletedVideoIds, nonDeletedVideoIds: nonDeletedVideoIds};
}

async function finalize_POST(jwtToken, videoIds) {
    let result;

    const response = await node_finalizeVideos(jwtToken, videoIds);

    if(!response.isError) {
        const finalizedVideoIds = response.finalizedVideoIds;
        const nonFinalizedVideoIds = response.nonFinalizedVideoIds;
        
        for(const finalizedVideoId of finalizedVideoIds) {
            const videoDirectory = path.join(getVideosDirectoryPath(), finalizedVideoId);
            
            await deleteDirectoryRecursive(videoDirectory);
            
            websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'finalized', videoId: finalizedVideoId }}});
        }
        
        result = {isError: false, finalizedVideoIds: finalizedVideoIds, nonFinalizedVideoIds: nonFinalizedVideoIds};
    }
    else {
        result = response;
    }

    return result;
}

async function videoIdIndexAdd_POST(jwtToken, videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken) {
    const response = await node_addVideoToIndex(jwtToken, videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken);

    return response;
}

async function videoIdIndexRemove_POST(jwtToken, videoId, cloudflareTurnstileToken) {
    const response = await node_removeVideoFromIndex(jwtToken, videoId, cloudflareTurnstileToken);

    return response;
}

async function videoIdThumbnail_POST(jwtToken, videoId, thumbnailFile) {
    let result;

    if (thumbnailFile != null && thumbnailFile.length === 1) {
        thumbnailFile = thumbnailFile[0];

        const thumbnailBuffer = await sharp(thumbnailFile.buffer).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toBuffer();
        
        const nodeSettings = await getNodeSettings(jwtToken);

        const storageConfig = nodeSettings.storageConfig;
        const storageMode = storageConfig.storageMode;

        if(storageMode === 'filesystem') {
            logDebugMessageToConsole('uploading thumbnail image to node for video: ' + videoId, null, null);

            await node_setThumbnail(jwtToken, videoId, thumbnailBuffer);

            logDebugMessageToConsole('uploaded thumbnail image to node for video: ' + videoId, null, null);
        }
        else if(storageMode === 's3provider') {
            logDebugMessageToConsole('uploading thumbnail image to s3 for video: ' + videoId, null, null);

            const s3Config = storageConfig.s3Config;

            const key = 'external/videos/' + videoId + '/images/thumbnail.jpg';

            await s3_putObjectFromData(s3Config, key, thumbnailBuffer, 'image/jpeg');
            
            logDebugMessageToConsole('uploaded thumbnail image to s3 for video: ' + videoId, null, null);
        }
        else {
            throw new Error('videoIdThumbnail_POST received invalid storageMode: ' + storageMode);
        }

        result = { isError: false };
    }
    else {
        result = { isError: true, message: 'thumbnail file is missing' };
    }

    return result;
}

async function videoIdPreview_POST(jwtToken, videoId, previewFile) {
    let result;

    if (previewFile != null && previewFile.length === 1) {
        previewFile = previewFile[0];

        const previewFileBuffer = await sharp(previewFile.buffer).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toBuffer();

        const nodeSettings = await getNodeSettings(jwtToken);

        const storageConfig = nodeSettings.storageConfig;
        const storageMode = storageConfig.storageMode;

        if(storageMode === 'filesystem') {
            logDebugMessageToConsole('uploading preview image to node for video: ' + videoId, null, null);

            await node_setPreview(jwtToken, videoId, previewFileBuffer);

            logDebugMessageToConsole('uploaded preview image to node for video: ' + videoId, null, null);
        }
        else if(storageMode === 's3provider') {
            logDebugMessageToConsole('uploading preview image to s3 for video: ' + videoId, null, null);

            const s3Config = storageConfig.s3Config;

            const key = 'external/videos/' + videoId + '/images/preview.jpg';

            await s3_putObjectFromData(s3Config, key, previewFileBuffer, 'image/jpeg');
            
            logDebugMessageToConsole('uploaded preview image to s3 for video: ' + videoId, null, null);
        }
        else {
            throw new Error('videoIdPreview_POST received invalid storageMode: ' + storageMode);
        }

        result = { isError: false };
    }
    else {
        result = { isError: true, message: 'preview file is missing' };
    }

    return result;
}

async function videoIdPoster_POST(jwtToken, videoId, posterFile) {
    let result;

    if (posterFile != null && posterFile.length === 1) {
        posterFile = posterFile[0];

        const posterFileBuffer = await sharp(posterFile.buffer).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toBuffer();

        const nodeSettings = await getNodeSettings(jwtToken);

        const storageConfig = nodeSettings.storageConfig;
        const storageMode = storageConfig.storageMode;

        if(storageMode === 'filesystem') {
            logDebugMessageToConsole('uploading poster image to node for video: ' + videoId, null, null);

            await node_setPoster(jwtToken, videoId, posterFileBuffer);

            logDebugMessageToConsole('uploaded poster image to node for video: ' + videoId, null, null);
        }
        else if(storageMode === 's3provider') {
            logDebugMessageToConsole('uploading poster image to s3 for video: ' + videoId, null, null);

            const s3Config = storageConfig.s3Config;

            const key = 'external/videos/' + videoId + '/images/poster.jpg';

            await s3_putObjectFromData(s3Config, key, posterFileBuffer, 'image/jpeg');
            
            logDebugMessageToConsole('uploaded poster image to s3 for video: ' + videoId, null, null);
        }
        else {
            throw new Error('videoIdPoster_POST received invalid storageMode: ' + storageMode);
        }

        result = { isError: false };
    } 
    else {
        result = { isError: true, message: 'poster file is missing' };
    }

    return result;
}

async function videoIdSources_GET(videoId) {
    let result;

    const response = await node_getVideoSources(videoId);

    if(!response.isError) {
        const video = response.video;

        const adaptiveSources = video.adaptiveSources;
        const progressiveSources = video.progressiveSources;

        result  = {isError: false, sources: { adaptiveSources: adaptiveSources, progressiveSources: progressiveSources }};
    }
    else {
        result = response;
    }

    return result;
}

module.exports = {
    search_GET,
    import_POST,
    videoIdImportingStop_POST,
    videoIdPublishingStop_POST,
    videoIdPublish_POST,
    videoIdUnpublish_POST,
    tags_GET,
    tagsAll_GET,
    videoIdPublishes_GET,
    videoIdData_GET,
    videoIdData_POST,
    delete_POST,
    finalize_POST,
    videoIdIndexAdd_POST,
    videoIdIndexRemove_POST,
    videoIdThumbnail_POST,
    videoIdPreview_POST,
    videoIdPoster_POST,
    videoIdSources_GET
};