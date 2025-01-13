const path = require('path');
const fs = require('fs');
const spawnSync = require('child_process').spawnSync;
const sharp = require('sharp');
const multer = require('multer');

sharp.cache(false);

const { logDebugMessageToConsole, deleteDirectoryRecursive, getVideosDirectoryPath, timestampToSeconds, websocketClientBroadcast, getFfmpegPath } = require('../utils/helpers');
const { 
    node_stopVideoImporting, node_doVideosSearch, node_getVideoData, node_unpublishVideo, node_stopVideoPublishing,
    node_setSourceFileExtension, node_setThumbnail, node_setPreview, node_setPoster, node_setVideoLengths, node_setVideoImported, node_getVideosTags, node_getSourceFileExtension, 
    node_getVideosTagsAll, node_getVideoPublishes, node_setVideoData, node_deleteVideos, node_finalizeVideos, node_addVideoToIndex, node_removeVideoFromIndex, node_getVideoSources,
    node_getSettings
} = require('../utils/node-communications');
const {
    s3_putObjectFromData
} = require('../utils/s3-communications');
const { enqueuePendingPublishVideo } = require('../utils/trackers/pending-publish-video-tracker');

function search_GET(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    return new Promise(function(resolve, reject) {
        node_doVideosSearch(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, searchResults: nodeResponseData.searchResults});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function import_POST(jwtToken, videoFile, videoId) {
    return new Promise(async function(resolve, reject) {
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

            const result = spawnSync(getFfmpegPath(), ['-i', videoFilePath], { encoding: 'utf-8' });
            
            const durationIndex = result.stderr.indexOf('Duration: ');
            const lengthTimestamp = result.stderr.substr(durationIndex + 10, 11);
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
            const sourceImagePath = path.join(imagesDirectoryPath, 'source.jpg');
            
            fs.mkdirSync(imagesDirectoryPath, { recursive: true });
            
            spawnSync(getFfmpegPath(), ['-ss', imageExtractionTimestamp, '-i', videoFilePath, sourceImagePath]);

            logDebugMessageToConsole('generating thumbnail, preview, and poster for video: ' + videoId, null, null);
            const thumbnailBuffer = await sharp(sourceImagePath).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toBuffer();
            const previewFileBuffer = await sharp(sourceImagePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toBuffer();
            const posterFileBuffer = await sharp(sourceImagePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toBuffer();
            logDebugMessageToConsole('generated thumbnail, preview, and poster for video: ' + videoId, null, null);

            const nodeSettings = (await node_getSettings(jwtToken)).nodeSettings;

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

                await s3_putObjectFromData(s3Config, thumbnailImageKey, thumbnailBuffer);
                await s3_putObjectFromData(s3Config, previewImageKey, previewFileBuffer);
                await s3_putObjectFromData(s3Config, posterImageKey, posterFileBuffer);
            }

            await deleteDirectoryRecursive(imagesDirectoryPath);

            await node_setVideoImported(jwtToken, videoId);

            logDebugMessageToConsole('flagging video as imported to node for video: ' + videoId, null, null);
            
            websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'imported', videoId: videoId, lengthTimestamp: lengthTimestamp }}});
            
            resolve({isError: false});
        }
        else {
            resolve({isError: true, message: 'video file is missing'});
        }
    });
}

function videoIdImportingStop_POST(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing_stopping', videoId: videoId }}});
        
        node_stopVideoImporting(jwtToken, videoId)
        .then((nodeResponseData) => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing_stopped', videoId: videoId }}});
                
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdPublishingStop_POST(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing_stopping', videoId: videoId }}});
        
        node_stopVideoPublishing(jwtToken, videoId)
        .then((nodeResponseData) => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing_stopped', videoId: videoId }}});
        
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdPublish_POST(jwtToken, videoId, publishings) {
    return new Promise(function(resolve, reject) {
        publishings = JSON.parse(publishings);

        node_getVideoData(videoId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const isLive = nodeResponseData.videoData.isLive;
                const isStreaming = nodeResponseData.videoData.isStreaming;
                const isFinalized = nodeResponseData.videoData.isFinalized;
                
                if(isLive && isStreaming) {
                    resolve({isError: true, message: 'this video is currently streaming'});
                }
                else if(isFinalized) {
                    resolve({isError: true, message: 'this video was finalized; no further publishings are possible'});
                }
                else {
                    node_getSourceFileExtension(jwtToken, videoId)
                    .then(nodeResponseData => {
                        if(nodeResponseData.isError) {
                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                            
                            resolve({isError: true, message: nodeResponseData.message});
                        }
                        else {
                            const sourceFileExtension = nodeResponseData.sourceFileExtension;
                            
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
                                
                                resolve({isError: false});
                            }
                            else {
                                if(isLive) {
                                    resolve({isError: true, message: 'a recording of this stream does not exist<br>record your streams locally for later publishing'});
                                }
                                else {
                                    resolve({isError: true, message: 'a source for this video does not exist'});
                                }
                            }
                        }
                    });
                }
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdUnpublish_POST(jwtToken, videoId, format, resolution) {
    return new Promise(function(resolve, reject) {
        node_getVideoData(videoId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                node_unpublishVideo(jwtToken, videoId, format, resolution)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        
                        resolve({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        resolve({isError: false});
                    }
                })
                .catch(error => {
                    reject(error);
                });
            }
        });
    });
}

function tags_GET(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_getVideosTags(jwtToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, tags: nodeResponseData.tags});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function tagsAll_GET(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_getVideosTagsAll(jwtToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, tags: nodeResponseData.tags});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdPublishes_GET(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        node_getVideoPublishes(jwtToken, videoId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, publishes: nodeResponseData.publishes});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdData_GET(videoId) {
    return new Promise(function(resolve, reject) {
        node_getVideoData(videoId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, videoData: nodeResponseData.videoData});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdData_POST(jwtToken, videoId, title, description, tags) {
    return new Promise(function(resolve, reject) {
        node_setVideoData(jwtToken, videoId, title, description, tags)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, videoData: nodeResponseData.videoData});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function delete_POST(jwtToken, videoIdsJson) {
    return new Promise(function(resolve, reject) {
        node_deleteVideos(jwtToken, videoIdsJson)
        .then(async nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const deletedVideoIds = nodeResponseData.deletedVideoIds;
                const nonDeletedVideoIds = nodeResponseData.nonDeletedVideoIds;

                for(const deletedVideoId of deletedVideoIds) {
                    const deletedVideoIdPath = path.join(getVideosDirectoryPath(), deletedVideoId);
                    
                    await deleteDirectoryRecursive(deletedVideoIdPath);
                }
                
                resolve({isError: false, deletedVideoIds: deletedVideoIds, nonDeletedVideoIds: nonDeletedVideoIds});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function finalize_POST(jwtToken, videoIdsJson) {
    return new Promise(function(resolve, reject) {
        node_finalizeVideos(jwtToken, videoIdsJson)
        .then(async nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const finalizedVideoIds = nodeResponseData.finalizedVideoIds;
                const nonFinalizedVideoIds = nodeResponseData.nonFinalizedVideoIds;
                
                for(const finalizedVideoId of finalizedVideoIds) {
                    const videoDirectory = path.join(getVideosDirectoryPath(), finalizedVideoId);
                    
                    await deleteDirectoryRecursive(videoDirectory);
                    
                    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'finalized', videoId: finalizedVideoId }}});
                }
                
                resolve({isError: false, finalizedVideoIds: finalizedVideoIds, nonFinalizedVideoIds: nonFinalizedVideoIds});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdIndexAdd_POST(jwtToken, videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken) {
    return new Promise(function(resolve, reject) {
        node_addVideoToIndex(jwtToken, videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdIndexRemove_POST(jwtToken, videoId, cloudflareTurnstileToken) {
    return new Promise(function(resolve, reject) {
        node_removeVideoFromIndex(jwtToken, videoId, cloudflareTurnstileToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdThumbnail_POST(jwtToken, videoId, thumbnailFile) {
    return new Promise(function (resolve, reject) {
        if (thumbnailFile != null && thumbnailFile.length === 1) {
            thumbnailFile = thumbnailFile[0];

            sharp(thumbnailFile.buffer).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toBuffer()
            .then(async (thumbnailBuffer) => {
                const nodeSettings = (await node_getSettings(jwtToken)).nodeSettings;

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

                    await s3_putObjectFromData(s3Config, key, thumbnailBuffer);
                    
                    logDebugMessageToConsole('uploaded thumbnail image to s3 for video: ' + videoId, null, null);
                }
                else {
                    throw new Error('videoIdThumbnail_POST received invalid storageMode: ' + storageMode);
                }

                resolve({ isError: false });
            })
            .catch((error) => {
                reject(error);
            });
        } else {
            resolve({ isError: true, message: 'thumbnail file is missing' });
        }
    });
}

function videoIdPreview_POST(jwtToken, videoId, previewFile) {
    return new Promise(function (resolve, reject) {
        if (previewFile != null && previewFile.length === 1) {
            previewFile = previewFile[0];

            sharp(previewFile.buffer).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toBuffer()
            .then(async (previewFileBuffer) => {
                const nodeSettings = (await node_getSettings(jwtToken)).nodeSettings;

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

                    await s3_putObjectFromData(s3Config, key, previewFileBuffer);
                    
                    logDebugMessageToConsole('uploaded preview image to s3 for video: ' + videoId, null, null);
                }
                else {
                    throw new Error('videoIdPreview_POST received invalid storageMode: ' + storageMode);
                }

                resolve({ isError: false });
            })
            .catch((error) => {
                reject(error);
            });
        } else {
            resolve({ isError: true, message: 'preview file is missing' });
        }
    });
}

function videoIdPoster_POST(jwtToken, videoId, posterFile) {
    return new Promise(function (resolve, reject) {
        if (posterFile != null && posterFile.length === 1) {
            posterFile = posterFile[0];

            sharp(posterFile.buffer).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toBuffer()
            .then(async (posterFileBuffer) => {
                const nodeSettings = (await node_getSettings(jwtToken)).nodeSettings;

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

                    await s3_putObjectFromData(s3Config, key, posterFileBuffer);
                    
                    logDebugMessageToConsole('uploaded poster image to s3 for video: ' + videoId, null, null);
                }
                else {
                    throw new Error('videoIdPoster_POST received invalid storageMode: ' + storageMode);
                }

                resolve({ isError: false });
            })
            .catch((error) => {
                reject(error);
            });
        } else {
            resolve({ isError: true, message: 'poster file is missing' });
        }
    });
}

function videoIdSources_GET(videoId) {
    return new Promise(function(resolve, reject) {
        node_getVideoSources(videoId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const video = nodeResponseData.video;

                const adaptiveSources = video.adaptiveSources;
                const progressiveSources = video.progressiveSources;

                resolve({isError: false, sources: { adaptiveSources: adaptiveSources, progressiveSources: progressiveSources }});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
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