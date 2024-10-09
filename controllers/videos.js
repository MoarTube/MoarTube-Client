const path = require('path');
const fs = require('fs');
const spawnSync = require('child_process').spawnSync;
const sharp = require('sharp');
const multer = require('multer');

sharp.cache(false);

const { logDebugMessageToConsole, deleteDirectoryRecursive, getVideosDirectoryPath, timestampToSeconds, websocketClientBroadcast, getFfmpegPath } = require('../utils/helpers');
const { 
    node_stopVideoImporting, node_doVideosSearch, node_getThumbnail, node_getPreview, node_getPoster, node_getVideoData, node_unpublishVideo, node_stopVideoPublishing,
    node_setSourceFileExtension, node_setThumbnail, node_setPreview, node_setPoster, node_setVideoLengths, node_setVideoImported, node_getVideosTags, node_getSourceFileExtension, 
    node_getVideosTagsAll, node_getVideoPublishes, node_setVideoData, node_deleteVideos, node_finalizeVideos, node_addVideoToIndex, node_removeVideoFromIndex, node_getVideoSources
} = require('../utils/node-communications');
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
    return new Promise(function(resolve, reject) {
        if(videoFile != null && videoFile.length === 1) {
            videoFile = videoFile[0];

            const videoFilePath = videoFile.path;
            
            let sourceFileExtension = '';
            if(videoFile.mimetype === 'video/mp4') {
                sourceFileExtension = '.mp4';
            }
            else if(videoFile.mimetype === 'video/webm') {
                sourceFileExtension = '.webm';
            }
            
            node_setSourceFileExtension(jwtToken, videoId, sourceFileExtension)
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                    
                    resolve({isError: true, message: nodeResponseData.message});
                }
                else {
                    const result = spawnSync(getFfmpegPath(), [
                        '-i', videoFilePath
                    ], 
                    {encoding: 'utf-8' }
                    );
                    
                    const durationIndex = result.stderr.indexOf('Duration: ');
                    const lengthTimestamp = result.stderr.substr(durationIndex + 10, 11);
                    const lengthSeconds = timestampToSeconds(lengthTimestamp);
                    
                    logDebugMessageToConsole('generating images for video: ' + videoId, null, null);
                    
                    const imagesDirectoryPath = path.join(getVideosDirectoryPath(), videoId + '/images');
                    const sourceImagePath = path.join(imagesDirectoryPath, 'source.jpg');
                    const thumbnailImagePath = path.join(imagesDirectoryPath, 'thumbnail.jpg');
                    const previewImagePath = path.join(imagesDirectoryPath, 'preview.jpg');
                    const posterImagePath = path.join(imagesDirectoryPath, 'poster.jpg');
                    
                    fs.mkdirSync(imagesDirectoryPath, { recursive: true });
                    
                    const imageExtractionTimestamp = Math.floor(lengthSeconds * 0.25);
                    
                    spawnSync(getFfmpegPath(), ['-ss', imageExtractionTimestamp, '-i', videoFilePath, sourceImagePath]);
                    
                    sharp(sourceImagePath).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toFile(thumbnailImagePath)
                    .then(() => {
                        sharp(sourceImagePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toFile(previewImagePath)
                        .then(() => {
                            sharp(sourceImagePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toFile(posterImagePath)
                            .then(() => {
                                if(!fs.existsSync(thumbnailImagePath)) {
                                    logDebugMessageToConsole('expected a thumbnail to be generated in <' + thumbnailImagePath + '> but found none', null, new Error().stack);
                                    
                                    resolve({isError: true, message: 'error communicating with the MoarTube node'});
                                }
                                else if(!fs.existsSync(previewImagePath)) {
                                    logDebugMessageToConsole('expected a preview to be generated in <' + previewImagePath + '> but found none', null, new Error().stack);
                                    
                                    resolve({isError: true, message: 'error communicating with the MoarTube node'});
                                }
                                else if(!fs.existsSync(posterImagePath)) {
                                    logDebugMessageToConsole('expected a poster to be generated in <' + posterImagePath + '> but found none', null, new Error().stack);
                                    
                                    resolve({isError: true, message: 'error communicating with the MoarTube node'});
                                }
                                else {
                                    logDebugMessageToConsole('generated thumbnail, preview, and poster for video: ' + videoId, null, null);
                                    
                                    logDebugMessageToConsole('uploading thumbnail, preview, and poster to node for video: ' + videoId, null, null);
                                    
                                    node_setThumbnail(jwtToken, videoId, thumbnailImagePath)
                                    .then(nodeResponseData => {
                                        if(nodeResponseData.isError) {
                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                                            
                                            resolve({isError: true, message: nodeResponseData.message});
                                        }
                                        else {
                                            logDebugMessageToConsole('uploaded thumbnail to node for video: ' + videoId, null, null);
                                            
                                            node_setPreview(jwtToken, videoId, previewImagePath)
                                            .then(nodeResponseData => {
                                                if(nodeResponseData.isError) {
                                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                                                    
                                                    resolve({isError: true, message: nodeResponseData.message});
                                                }
                                                else {
                                                    logDebugMessageToConsole('uploaded preview to node for video: ' + videoId, null, null);
                                                    
                                                    node_setPoster(jwtToken, videoId, posterImagePath)
                                                    .then(async nodeResponseData => {
                                                        if(nodeResponseData.isError) {
                                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                                                            
                                                            resolve({isError: true, message: nodeResponseData.message});
                                                        }
                                                        else {
                                                            logDebugMessageToConsole('uploaded poster to node for video: ' + videoId, null, null);
                                                            
                                                            await deleteDirectoryRecursive(imagesDirectoryPath);
                                                            
                                                            logDebugMessageToConsole('uploading video length to node for video: ' + videoId, null, null);
                                                            
                                                            node_setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp)
                                                            .then(nodeResponseData => {
                                                                if(nodeResponseData.isError) {
                                                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                                                                    
                                                                    resolve({isError: true, message: nodeResponseData.message});
                                                                }
                                                                else {
                                                                    logDebugMessageToConsole('uploaded video length to node for video: ' + videoId, null, null);
                                                                    
                                                                    node_setVideoImported(jwtToken, videoId)
                                                                    .then(nodeResponseData => {
                                                                        if(nodeResponseData.isError) {
                                                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                                                                            
                                                                            resolve({isError: true, message: nodeResponseData.message});
                                                                        }
                                                                        else {
                                                                            logDebugMessageToConsole('flagging video as imported to node for video: ' + videoId, null, null);
                                                                            
                                                                            websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'imported', videoId: videoId, lengthTimestamp: lengthTimestamp }}});
                                                                            
                                                                            resolve({isError: false});
                                                                        }
                                                                    })
                                                                    .catch(error => {
                                                                        reject(error);
                                                                    });
                                                                }
                                                            })
                                                            .catch(error => {
                                                                reject(error);
                                                            });
                                                        }
                                                    })
                                                    .catch(error => {
                                                        reject(error);
                                                    });
                                                }
                                            })
                                            .catch(error => {
                                                reject(error);
                                            });
                                        }
                                    })
                                    .catch(error => {
                                        reject(error);
                                    });
                                }
                            })
                            .catch(error => {
                                reject(error);
                            });
                        })
                        .catch(error => {
                            reject(error);
                        });
                    })
                    .catch(error => {
                        reject(error);
                    });
                }
            })
            .catch(error => {
                reject(error);
            });
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

function videoIdThumbnail_GET(videoId) {
    return new Promise(function(resolve, reject) {
        node_getThumbnail(videoId)
        .then(nodeResponseData => {
            resolve(nodeResponseData);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdPreview_GET(videoId) {
    return new Promise(function(resolve, reject) {
        node_getPreview(videoId)
        .then(nodeResponseData => {
            resolve(nodeResponseData);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdPoster_GET(videoId) {
    return new Promise(function(resolve, reject) {
        node_getPoster(videoId)
        .then(nodeResponseData => {
            resolve(nodeResponseData);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdThumbnail_POST(jwtToken, videoId, thumbnailFile) {
    return new Promise(function(resolve, reject) {
        if(thumbnailFile != null && thumbnailFile.length === 1) {
            thumbnailFile = thumbnailFile[0];

            const sourceFilePath = path.join(getVideosDirectoryPath(), videoId + '/images/' + thumbnailFile.filename);
            const destinationFilePath = path.join(getVideosDirectoryPath(), videoId + '/images/thumbnail.jpg');
            
            sharp(sourceFilePath).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toFile(destinationFilePath)
            .then(() => {
                node_setThumbnail(jwtToken, videoId, destinationFilePath)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        
                        resolve({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        logDebugMessageToConsole('uploaded live preview to node for video: ' + videoId, null, null);
                        
                        fs.unlinkSync(destinationFilePath);
                        
                        resolve({isError: false});
                    }
                })
                .catch(error => {
                    reject(error);
                });
            })
            .catch(error => {
                reject(error);
            });
        }
        else {
            resolve({isError: true, message: 'thumbnail file is missing'});
        }
    });
}

function videoIdPreview_POST(jwtToken, videoId, previewFile) {
    return new Promise(function(resolve, reject) {
        if(previewFile != null && previewFile.length === 1) {
            previewFile = previewFile[0];

            const sourceFilePath = path.join(getVideosDirectoryPath(), videoId + '/images/' + previewFile.filename);
            const destinationFilePath = path.join(getVideosDirectoryPath(), videoId + '/images/preview.jpg');
            
            sharp(sourceFilePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toFile(destinationFilePath)
            .then(() => {
                node_setPreview(jwtToken, videoId, destinationFilePath)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        
                        resolve({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        logDebugMessageToConsole('uploaded live preview to node for video: ' + videoId, null, null);
                        
                        fs.unlinkSync(destinationFilePath);
                        
                        resolve({isError: false});
                    }
                })
                .catch(error => {
                    reject(error);
                });
            })
            .catch(error => {
                reject(error);
            });
        }
        else {
            resolve({isError: true, message: 'preview file is missing'});
        }
    });
}

function videoIdPoster_POST(jwtToken, videoId, posterFile) {
    return new Promise(function(resolve, reject) {
        if(posterFile != null && posterFile.length === 1) {
            posterFile = posterFile[0];
        
            const sourceFilePath = path.join(getVideosDirectoryPath(), videoId + '/images/' + posterFile.filename);
            const destinationFilePath = path.join(getVideosDirectoryPath(), videoId + '/images/poster.jpg');
            
            sharp(sourceFilePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toFile(destinationFilePath)
            .then(() => {
                node_setPoster(jwtToken, videoId, destinationFilePath)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        
                        resolve({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        logDebugMessageToConsole('uploaded live poster to node for video: ' + videoId, null, null);
                        
                        fs.unlinkSync(destinationFilePath);
                        
                        resolve({isError: false});
                    }
                })
                .catch(error => {
                    reject(error);
                });
            })
            .catch(error => {
                reject(error);
            });
        }
        else {
            resolve({isError: true, message: 'poster file is missing'});
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
    videoIdThumbnail_GET,
    videoIdPreview_GET,
    videoIdPoster_GET,
    videoIdThumbnail_POST,
    videoIdPreview_POST,
    videoIdPoster_POST,
    videoIdSources_GET
};