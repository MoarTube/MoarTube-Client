const path = require('path');
const fs = require('fs');
const spawnSync = require('child_process').spawnSync;
const sharp = require('sharp');
const multer = require('multer');

sharp.cache(false);

const { logDebugMessageToConsole, deleteDirectoryRecursive, getPublicDirectoryPath, getTempVideosDirectoryPath, timestampToSeconds, websocketClientBroadcast, getFfmpegPath } = require('../utils/helpers');
const { 
    node_isAuthenticated, node_doSignout, node_getSettings, node_stopVideoImporting, node_getVideoInformation, node_doVideosSearch, 
    node_getThumbnail, node_getPreview, node_getPoster, node_getVideoData, node_unpublishVideo, node_stopVideoPublishing, node_stopVideoStreaming, node_importVideo,
    node_setVideoError, node_setSourceFileExtension, node_setThumbnail, node_setPreview, node_setPoster, node_setVideoLengths, node_setVideoImported, node_getVideosTags,
    node_getSourceFileExtension, node_getVideosTagsAll, node_getVideoPublishes, node_setVideoInformation, node_deleteVideos, node_finalizeVideos, node_addVideoToIndex,
    node_removeVideoFromIndex, node_aliasVideo, node_getVideoAlias
} = require('../utils/node-communications');
const { addVideoToImportVideoTracker, isVideoImportStopping } = require('../utils/trackers/import-video-tracker');
const { enqueuePendingPublishVideo } = require('../utils/trackers/pending-publish-video-tracker');

function root_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getSettings(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        node_doSignout(req, res);
                    }
                    else {
                        const nodeSettings = nodeResponseData.nodeSettings;
                        
                        if(nodeSettings.isNodeConfigured) {
                            const pagePath = path.join(getPublicDirectoryPath(), 'pages/videos.html');
                            const fileStream = fs.createReadStream(pagePath);
                            res.setHeader('Content-Type', 'text/html');
                            fileStream.pipe(res);
                        }
                        else {
                            res.redirect('/configure');
                        }
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    node_doSignout(req, res);
                });
            }
            else {
                res.redirect('/account/signin');
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        node_doSignout(req, res);
    });
}

function search_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const searchTerm = req.query.searchTerm;
                const sortTerm = req.query.sortTerm;
                const tagTerm = req.query.tagTerm;
                const tagLimit = req.query.tagLimit;
                const timestamp = req.query.timestamp;
                
                node_doVideosSearch(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, searchResults: nodeResponseData.searchResults});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function import_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then((nodeResponseData) => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                logDebugMessageToConsole('attempting to import video file into the client file system', null, null, true);
                
                const totalFileSize = parseInt(req.headers['content-length']);
                
                if(totalFileSize > 0) {
                    logDebugMessageToConsole('importing video into the client file system: ' + totalFileSize + ' bytes', null, null, true);
                    
                    const title = req.query.title;
                    const description = req.query.description;
                    const tags = req.query.tags;
                    
                    logDebugMessageToConsole('requesting video id for imported video....', null, null, true);

                    node_importVideo(jwtToken, title, description, tags)
                    .then(nodeResponseData => {
                        if(nodeResponseData.isError) {
                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                            
                            res.send({isError: true, message: nodeResponseData.message});
                        }
                        else {
                            const videoId = nodeResponseData.videoId;
                            
                            logDebugMessageToConsole('imported video file assigned video id: ' + videoId, null, null, true);

                            addVideoToImportVideoTracker(videoId, req);
                            
                            let lastImportingTime = 0;
                            let receivedFileSize = 0;

                            req.on('data', function(chunk) {
                                if(!isVideoImportStopping(videoId)) {
                                    receivedFileSize += chunk.length;
                                    
                                    const importProgress = Math.floor((receivedFileSize / totalFileSize) * 100);
                                    
                                    const currentTime = Date.now();
                                    
                                    if(currentTime - lastImportingTime >= 100) {
                                        lastImportingTime = currentTime;
                                        
                                        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing', videoId: videoId, progress: importProgress }}});
                                    }
                                }
                            });
                            
                            multer({
                                storage: multer.diskStorage({
                                    destination: function (req, file, cb) {
                                        const sourceDirectoryPath =  path.join(getTempVideosDirectoryPath(), videoId + '/source');
                                        
                                        fs.mkdirSync(sourceDirectoryPath, { recursive: true });
                                        
                                        fs.access(sourceDirectoryPath, fs.constants.F_OK, function(error) {
                                            if(error) {
                                                cb(new Error('file upload error'), null);
                                            }
                                            else {
                                                cb(null, sourceDirectoryPath);
                                            }
                                        });
                                    },
                                    filename: function (req, file, cb) {
                                        let extension;
                                        
                                        if(file.mimetype === 'video/mp4') {
                                            extension = '.mp4';
                                        }
                                        else if(file.mimetype === 'video/webm') {
                                            extension = '.webm';
                                        }
                                        
                                        const fileName = videoId + extension;
                                        
                                        logDebugMessageToConsole('imported video file and assigned temporary file name: ' + fileName, null, null, true);
                                        
                                        cb(null, fileName);
                                    }
                                })
                            }).fields([{ name: 'video_file', maxCount: 1 }])
                            (req, res, function(error) {
                                if(error) {
                                    logDebugMessageToConsole(nodeResponseData.message, error, new Error().stack, true);
                                    
                                    node_setVideoError(jwtToken, videoId)
                                    .then(nodeResponseData => {
                                        if(nodeResponseData.isError) {
                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                            
                                            res.send({isError: true, message: nodeResponseData.message});
                                        }
                                        else {
                                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                        }
                                    })
                                    .catch(error => {
                                        logDebugMessageToConsole(null, error, new Error().stack, true);
                                        
                                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                    });
                                }
                                else {
                                    const videoFile = req.files['video_file'][0];
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
                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                            
                                            res.send({isError: true, message: nodeResponseData.message});
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
                                            
                                            logDebugMessageToConsole('generating images for video: ' + videoId, null, null, true);
                                            
                                            const imagesDirectoryPath = path.join(getTempVideosDirectoryPath(), videoId + '/images');
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
                                                            logDebugMessageToConsole('expected a thumbnail to be generated in <' + thumbnailImagePath + '> but found none', null, new Error().stack, true);
                                                            
                                                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                        }
                                                        else if(!fs.existsSync(previewImagePath)) {
                                                            logDebugMessageToConsole('expected a preview to be generated in <' + previewImagePath + '> but found none', null, new Error().stack, true);
                                                            
                                                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                        }
                                                        else if(!fs.existsSync(posterImagePath)) {
                                                            logDebugMessageToConsole('expected a poster to be generated in <' + posterImagePath + '> but found none', null, new Error().stack, true);
                                                            
                                                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                        }
                                                        else {
                                                            logDebugMessageToConsole('generated thumbnail, preview, and poster for video: ' + videoId, null, null, true);
                                                            
                                                            logDebugMessageToConsole('uploading thumbnail, preview, and poster to node for video: ' + videoId, null, null, true);
                                                            
                                                            node_setThumbnail(jwtToken, videoId, thumbnailImagePath)
                                                            .then(nodeResponseData => {
                                                                if(nodeResponseData.isError) {
                                                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                                    
                                                                    res.send({isError: true, message: nodeResponseData.message});
                                                                }
                                                                else {
                                                                    logDebugMessageToConsole('uploaded thumbnail to node for video: ' + videoId, null, null, true);
                                                                    
                                                                    node_setPreview(jwtToken, videoId, previewImagePath)
                                                                    .then(nodeResponseData => {
                                                                        if(nodeResponseData.isError) {
                                                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                                            
                                                                            res.send({isError: true, message: nodeResponseData.message});
                                                                        }
                                                                        else {
                                                                            logDebugMessageToConsole('uploaded preview to node for video: ' + videoId, null, null, true);
                                                                            
                                                                            node_setPoster(jwtToken, videoId, posterImagePath)
                                                                            .then(nodeResponseData => {
                                                                                if(nodeResponseData.isError) {
                                                                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                                                    
                                                                                    res.send({isError: true, message: nodeResponseData.message});
                                                                                }
                                                                                else {
                                                                                    logDebugMessageToConsole('uploaded poster to node for video: ' + videoId, null, null, true);
                                                                                    
                                                                                    deleteDirectoryRecursive(imagesDirectoryPath);
                                                                                    
                                                                                    logDebugMessageToConsole('uploading video length to node for video: ' + videoId, null, null, true);
                                                                                    
                                                                                    node_setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp)
                                                                                    .then(nodeResponseData => {
                                                                                        if(nodeResponseData.isError) {
                                                                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                                                            
                                                                                            res.send({isError: true, message: nodeResponseData.message});
                                                                                        }
                                                                                        else {
                                                                                            logDebugMessageToConsole('uploaded video length to node for video: ' + videoId, null, null, true);
                                                                                            
                                                                                            node_setVideoImported(jwtToken, videoId)
                                                                                            .then(nodeResponseData => {
                                                                                                if(nodeResponseData.isError) {
                                                                                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                                                                    
                                                                                                    res.send({isError: true, message: nodeResponseData.message});
                                                                                                }
                                                                                                else {
                                                                                                    logDebugMessageToConsole('flagging video as imported to node for video: ' + videoId, null, null, true);
                                                                                                    
                                                                                                    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'imported', videoId: videoId, lengthTimestamp: lengthTimestamp }}});
                                                                                                    
                                                                                                    res.send({isError: false});
                                                                                                }
                                                                                            })
                                                                                            .catch(error => {
                                                                                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                                                                                
                                                                                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                                                            });
                                                                                        }
                                                                                    })
                                                                                    .catch(error => {
                                                                                        logDebugMessageToConsole(null, error, new Error().stack, true);
                                                                                        
                                                                                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                                                    });
                                                                                }
                                                                            })
                                                                            .catch(error => {
                                                                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                                                                
                                                                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                                            });
                                                                        }
                                                                    })
                                                                    .catch(error => {
                                                                        logDebugMessageToConsole(null, error, new Error().stack, true);
                                                                        
                                                                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                                    });
                                                                }
                                                            })
                                                            .catch(error => {
                                                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                                                
                                                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                            });
                                                        }
                                                    })
                                                    .catch(error => {
                                                        logDebugMessageToConsole(null, error, new Error().stack, true);
                                                        
                                                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                    });
                                                })
                                                .catch(error => {
                                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                                    
                                                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                                });
                                            })
                                            .catch(error => {
                                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                                
                                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                            });
                                        }
                                    })
                                    .catch(error => {
                                        logDebugMessageToConsole(null, error, new Error().stack, true);
                                        
                                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                    });
                                }
                            });
                        }
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    });
                }
                else {
                    logDebugMessageToConsole('expected totalFileSize of non-zero but got zero', null, null, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                }
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdImportingStop_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing_stopping', videoId: videoId }}});
                
                node_stopVideoImporting(jwtToken, videoId)
                .then((nodeResponseData) => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing_stopped', videoId: videoId }}});
                        
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdPublishingStop_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing_stopping', videoId: videoId }}});
                
                node_stopVideoPublishing(jwtToken, videoId)
                .then((nodeResponseData) => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing_stopped', videoId: videoId }}});
                
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdPublish_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                const publishings = JSON.parse(req.body.publishings);
                
                node_getVideoInformation(jwtToken, videoId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        const isLive = nodeResponseData.information.isLive;
                        const isStreaming = nodeResponseData.information.isStreaming;
                        const isFinalized = nodeResponseData.information.isFinalized;
                        
                        if(isLive && isStreaming) {
                            res.send({isError: true, message: 'this video is currently streaming'});
                        }
                        else if(isFinalized) {
                            res.send({isError: true, message: 'this video was finalized; no further publishings are possible'});
                        }
                        else {
                            node_getSourceFileExtension(jwtToken, videoId)
                            .then(nodeResponseData => {
                                if(nodeResponseData.isError) {
                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                    
                                    res.send({isError: true, message: nodeResponseData.message});
                                }
                                else {
                                    const sourceFileExtension = nodeResponseData.sourceFileExtension;
                                    
                                    const sourceFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/source/' + videoId + sourceFileExtension);

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
                                        
                                        res.send({isError: false});
                                    }
                                    else {
                                        if(isLive) {
                                            res.send({isError: true, message: 'a recording of this stream does not exist<br>record your streams locally for later publishing'});
                                        }
                                        else {
                                            res.send({isError: true, message: 'a source for this video does not exist'});
                                        }
                                    }
                                }
                            });
                        }
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdUnpublish_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                const format = req.body.format;
                const resolution = req.body.resolution;
                
                node_getVideoData(jwtToken, videoId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        node_unpublishVideo(jwtToken, videoId, format, resolution)
                        .then(nodeResponseData => {
                            if(nodeResponseData.isError) {
                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                
                                res.send({isError: true, message: nodeResponseData.message});
                            }
                            else {
                                res.send({isError: false});
                            }
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        });
                    }
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function tags_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getVideosTags(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, tags: nodeResponseData.tags});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function tagsAll_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getVideosTagsAll(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, tags: nodeResponseData.tags});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdPublishes_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                node_getVideoPublishes(jwtToken, videoId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, publishes: nodeResponseData.publishes});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdInformation_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                node_getVideoInformation(jwtToken, videoId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, information: nodeResponseData.information});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdInformation_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                const title = req.body.title;
                const description = req.body.description;
                const tags = req.body.tags;
                
                node_setVideoInformation(jwtToken, videoId, title, description, tags)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, information: nodeResponseData.information});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function delete_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoIdsJson = req.body.videoIdsJson;
                
                node_deleteVideos(jwtToken, videoIdsJson)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        const deletedVideoIds = nodeResponseData.deletedVideoIds;
                        const nonDeletedVideoIds = nodeResponseData.nonDeletedVideoIds;

                        for(const deletedVideoId of deletedVideoIds) {
                            const deletedVideoIdPath = path.join(getTempVideosDirectoryPath(), deletedVideoId);
                            
                            deleteDirectoryRecursive(deletedVideoIdPath);
                        }
                        
                        res.send({isError: false, deletedVideoIds: deletedVideoIds, nonDeletedVideoIds: nonDeletedVideoIds});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function finalize_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoIdsJson = req.body.videoIdsJson;
                
                node_finalizeVideos(jwtToken, videoIdsJson)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        const finalizedVideoIds = nodeResponseData.finalizedVideoIds;
                        const nonFinalizedVideoIds = nodeResponseData.nonFinalizedVideoIds;
                        
                        for(const finalizedVideoId of finalizedVideoIds) {
                            const videoDirectory = path.join(getTempVideosDirectoryPath(), finalizedVideoId);
                            
                            deleteDirectoryRecursive(videoDirectory);
                            
                            websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'finalized', videoId: finalizedVideoId }}});
                        }
                        
                        res.send({isError: false, finalizedVideoIds: finalizedVideoIds, nonFinalizedVideoIds: nonFinalizedVideoIds});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdIndexAdd_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                const captchaResponse = req.body.captchaResponse;
                const containsAdultContent = req.body.containsAdultContent;
                const termsOfServiceAgreed = req.body.termsOfServiceAgreed;

                node_addVideoToIndex(jwtToken, videoId, captchaResponse, containsAdultContent, termsOfServiceAgreed)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdIndexRemove_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;

                node_removeVideoFromIndex(jwtToken, videoId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdAlias_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                const captchaResponse = req.body.captchaResponse;
                
                node_aliasVideo(jwtToken, videoId, captchaResponse)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, videoAliasUrl: nodeResponseData.videoAliasUrl});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdAlias_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                node_getVideoAlias(jwtToken, videoId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, videoAliasUrl: nodeResponseData.videoAliasUrl});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdThumbnail_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.end();
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                node_getThumbnail(jwtToken, videoId)
                .then(nodeResponseData => {
                    res.setHeader('Content-Type', 'image/jpeg');
                    nodeResponseData.pipe(res);
                })
                .catch(error => {
                    logDebugMessageToConsole('thumbnail not found', error, new Error().stack, true);
                    
                    res.status(404).send('thumbnail not found');
                });
            }
            else {
                res.status(404).send('thumbnail not found');
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.status(404).send('thumbnail not found');
    });
}

function videoIdPreview_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.end();
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                node_getPreview(jwtToken, videoId)
                .then(nodeResponseData => {
                    res.setHeader('Content-Type', 'image/jpeg');
                    nodeResponseData.pipe(res);
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.end();
                });
            }
            else {
                res.end();
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.end();
    });
}

function videoIdPoster_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.end();
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                node_getPoster(jwtToken, videoId)
                .then(nodeResponseData => {
                    res.setHeader('Content-Type', 'image/jpeg');
                    nodeResponseData.pipe(res);
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.end();
                });
            }
            else {
                res.end();
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.end();
    });
}

function videoIdThumbnail_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                multer({
                    storage: multer.diskStorage({
                        destination: function (req, file, cb) {
                            const filePath = path.join(getTempVideosDirectoryPath(), videoId + '/images');
                            
                            fs.mkdirSync(filePath, { recursive: true });
                            
                            fs.access(filePath, fs.constants.F_OK, function(error) {
                                if(error) {
                                    cb(new Error('file upload error'), null);
                                }
                                else {
                                    cb(null, filePath);
                                }
                            });
                        },
                        filename: function (req, file, cb) {
                            let extension;
                            
                            if(file.mimetype === 'image/jpeg') {
                                extension = '.jpg';
                            }
                            
                            const fileName = Date.now() + extension;
                            
                            cb(null, fileName);
                        }
                    })
                }).fields([{ name: 'thumbnail_file', maxCount: 1 }])
                (req, res, function(error) {
                    if(error) {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    }
                    else {
                        const thumbnailFile = req.files['thumbnail_file'][0];
                    
                        const sourceFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/images/' + thumbnailFile.filename);
                        const destinationFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/images/thumbnail.jpg');
                        
                        sharp(sourceFilePath).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toFile(destinationFilePath)
                        .then(() => {
                            node_setThumbnail(jwtToken, videoId, destinationFilePath)
                            .then(nodeResponseData => {
                                if(nodeResponseData.isError) {
                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                    
                                    res.send({isError: true, message: nodeResponseData.message});
                                }
                                else {
                                    logDebugMessageToConsole('uploaded live preview to node for video: ' + videoId, null, null, true);
                                    
                                    fs.unlinkSync(destinationFilePath);
                                    
                                    res.send({isError: false});
                                }
                            })
                            .catch(error => {
                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                
                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                            });
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        });
                    }
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdPreview_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                multer({
                    storage: multer.diskStorage({
                        destination: function (req, file, cb) {
                            const filePath = path.join(getTempVideosDirectoryPath(), videoId + '/images');
                            
                            fs.mkdirSync(filePath, { recursive: true });
                            
                            fs.access(filePath, fs.constants.F_OK, function(error) {
                                if(error) {
                                    cb(new Error('file upload error'), null);
                                }
                                else {
                                    cb(null, filePath);
                                }
                            });
                        },
                        filename: function (req, file, cb) {
                            let extension;
                            
                            if(file.mimetype === 'image/jpeg') {
                                extension = '.jpg';
                            }
                            
                            const fileName = Date.now() + extension;
                            
                            cb(null, fileName);
                        }
                    })
                }).fields([{ name: 'preview_file', maxCount: 1 }])
                (req, res, function(error) {
                    if(error) {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    }
                    else {
                        const previewFile = req.files['preview_file'][0];
                    
                        const sourceFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/images/' + previewFile.filename);
                        const destinationFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/images/preview.jpg');
                        
                        sharp(sourceFilePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toFile(destinationFilePath)
                        .then(() => {
                            node_setPreview(jwtToken, videoId, destinationFilePath)
                            .then(nodeResponseData => {
                                if(nodeResponseData.isError) {
                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                    
                                    res.send({isError: true, message: nodeResponseData.message});
                                }
                                else {
                                    logDebugMessageToConsole('uploaded live preview to node for video: ' + videoId, null, null, true);
                                    
                                    fs.unlinkSync(destinationFilePath);
                                    
                                    res.send({isError: false});
                                }
                            })
                            .catch(error => {
                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                
                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                            });
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        });
                    }
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function videoIdPoster_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                multer({
                    storage: multer.diskStorage({
                        destination: function (req, file, cb) {
                            const filePath = path.join(getTempVideosDirectoryPath(), videoId + '/images');
                            
                            fs.mkdirSync(filePath, { recursive: true });
                            
                            fs.access(filePath, fs.constants.F_OK, function(error) {
                                if(error) {
                                    cb(new Error('file upload error'), null);
                                }
                                else {
                                    cb(null, filePath);
                                }
                            });
                        },
                        filename: function (req, file, cb) {
                            let extension;
                            
                            if(file.mimetype === 'image/jpeg') {
                                extension = '.jpg';
                            }
                            
                            const fileName = Date.now() + extension;
                            
                            cb(null, fileName);
                        }
                    })
                }).fields([{ name: 'poster_file', maxCount: 1 }])
                (req, res, function(error) {
                    if(error) {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    }
                    else {
                        const posterFile = req.files['poster_file'][0];
                    
                        const sourceFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/images/' + posterFile.filename);
                        const destinationFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/images/poster.jpg');
                        
                        sharp(sourceFilePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toFile(destinationFilePath)
                        .then(() => {
                            node_setPoster(jwtToken, videoId, destinationFilePath)
                            .then(nodeResponseData => {
                                if(nodeResponseData.isError) {
                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                    
                                    res.send({isError: true, message: nodeResponseData.message});
                                }
                                else {
                                    logDebugMessageToConsole('uploaded live poster to node for video: ' + videoId, null, null, true);
                                    
                                    fs.unlinkSync(destinationFilePath);
                                    
                                    res.send({isError: false});
                                }
                            })
                            .catch(error => {
                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                
                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                            });
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        });
                    }
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

module.exports = {
    root_GET,
    search_GET,
    import_POST,
    videoIdImportingStop_POST,
    videoIdPublishingStop_POST,
    videoIdPublish_POST,
    videoIdUnpublish_POST,
    tags_GET,
    tagsAll_GET,
    videoIdPublishes_GET,
    videoIdInformation_GET,
    videoIdInformation_POST,
    delete_POST,
    finalize_POST,
    videoIdIndexAdd_POST,
    videoIdIndexRemove_POST,
    videoIdAlias_POST,
    videoIdAlias_GET,
    videoIdThumbnail_GET,
    videoIdPreview_GET,
    videoIdPoster_GET,
    videoIdThumbnail_POST,
    videoIdPreview_POST,
    videoIdPoster_POST
};