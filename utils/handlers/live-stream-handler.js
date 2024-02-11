const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const sharp = require('sharp');

const { logDebugMessageToConsole, getAppDataVideosDirectoryPath, websocketClientBroadcast, getFfmpegPath, getClientSettings, timestampToSeconds } = require('../helpers');
const { node_setVideoLengths, node_getNextExpectedSegmentIndex, node_setThumbnail, node_setPreview, node_setPoster, node_uploadStream, node_getVideoBandwidth, 
    node_removeAdaptiveStreamSegment, node_stopVideoStreaming } = require('../node-communications');
const { addProcessToLiveStreamTracker, isLiveStreamStopping, liveStreamExists } = require('../trackers/live-stream-tracker');

function performStreamingJob(jwtToken, videoId, title, description, tags, rtmpUrl, format, resolution, isRecordingStreamRemotely, isRecordingStreamLocally) {
    return new Promise(function(resolve, reject) {
        logDebugMessageToConsole('starting live stream for id: ' + videoId, null, null, true);
        
        fs.mkdirSync(path.join(getAppDataVideosDirectoryPath(), videoId + '/source'), { recursive: true });
        fs.mkdirSync(path.join(getAppDataVideosDirectoryPath(), videoId + '/images'), { recursive: true });
        fs.mkdirSync(path.join(getAppDataVideosDirectoryPath(), videoId + '/adaptive'), { recursive: true });
        fs.mkdirSync(path.join(getAppDataVideosDirectoryPath(), videoId + '/progressive'), { recursive: true });
        
        const sourceDirectoryPath = path.join(getAppDataVideosDirectoryPath(), videoId + '/source');
        const sourceFilePath = path.join(sourceDirectoryPath, '/' + videoId + '.ts');
        const videoDirectory = path.join(getAppDataVideosDirectoryPath(), videoId + '/adaptive/m3u8');
        const manifestFileName = 'manifest-' + resolution + '.m3u8';
        const manifestFilePath = path.join(videoDirectory, '/' + manifestFileName);
        const segmentsDirectoryPath = path.join(videoDirectory, '/' + resolution);
        
        fs.mkdirSync(segmentsDirectoryPath, { recursive: true });
        
        const ffmpegArguments = generateFfmpegLiveArguments(videoId, resolution, format, rtmpUrl, isRecordingStreamRemotely);
        
        let process = spawn(getFfmpegPath(), ffmpegArguments);

        addProcessToLiveStreamTracker(videoId, process);
        
        let lengthSeconds = 0;
        let lengthTimestamp = '';
        process.stderr.on('data', function (data) {
            if(!isLiveStreamStopping(videoId)) {
                const stderrTemp = Buffer.from(data).toString();
                logDebugMessageToConsole(stderrTemp, null, null, true);
                
                if(stderrTemp.indexOf('time=') != -1) {
                    let index = stderrTemp.indexOf('time=');
                    lengthTimestamp = stderrTemp.substr(index + 5, 11);
                    lengthSeconds = timestampToSeconds(lengthTimestamp);
                    
                    node_setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp)
                    .then(nodeResponseData => {
                        if(nodeResponseData.isError) {
                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        }
                        else {
                            // do nothing
                        }
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                    });
                }
            }
        });
        
        let segmentInterval;

        process.on('spawn', function (code) {
            logDebugMessageToConsole('performStreamingJob ffmpeg process spawned with arguments: ' + ffmpegArguments, null, null, true);
            
            const segmentHistoryLength = 20;

            let uploadingThumbnail = false;
            let uploadingPreview = false;
            let uploadingPoster = false;

            let lastVideoImagesUpdateTimestamp = 0;
            
            segmentInterval = setInterval(function() {
                if(!isLiveStreamStopping(videoId)) {
                    (function() {
                        node_getNextExpectedSegmentIndex(jwtToken, videoId, format, resolution)
                        .then(nodeResponseData => {
                            if(nodeResponseData.isError) {
                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

                                clearInterval(segmentInterval);

                                process.kill();
                            }
                            else {
                                const nextExpectedSegmentIndex = nodeResponseData.nextExpectedSegmentIndex;
                                const segmentIndexToDelete = nextExpectedSegmentIndex - segmentHistoryLength;
                                
                                if(segmentIndexToDelete >= 0) {
                                    const segmentIndexToDeleteFileName = 'segment-' + resolution + '-' + segmentIndexToDelete + '.ts';
                                    const segmentIndexToDeleteFilePath = path.join(segmentsDirectoryPath, '/' + segmentIndexToDeleteFileName);
                                    
                                    fs.access(segmentIndexToDeleteFilePath, fs.constants.F_OK, function(error) {
                                        if(error) {
                                            
                                        }
                                        else {
                                            fs.unlink(segmentIndexToDeleteFilePath, function(error){
                                                
                                                
                                            });
                                        }
                                    });
                                }
                                
                                logDebugMessageToConsole('node expects the next segment index to be sent: ' + nextExpectedSegmentIndex, null, null, true);
                                
                                const expectedSegmentFileName = 'segment-' + resolution + '-' + nextExpectedSegmentIndex + '.ts';
                                const expectedSegmentFilePath = path.join(segmentsDirectoryPath, '/' + expectedSegmentFileName);
                                
                                if(fs.existsSync(manifestFilePath) && fs.existsSync(expectedSegmentFilePath)) {
                                    logDebugMessageToConsole('generating live images for video: ' + videoId, null, null, true);

                                    const directoryPaths = [
                                        {fileName : manifestFileName, filePath: manifestFilePath}, 
                                        {fileName : expectedSegmentFileName, filePath: expectedSegmentFilePath}
                                    ];
                                    
                                    node_uploadStream(jwtToken, videoId, 'm3u8', resolution, directoryPaths)
                                    .then(nodeResponseData => {
                                        if(nodeResponseData.isError) {
                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                        }
                                        else {
                                            if(isRecordingStreamLocally) {
                                                const inputStream = fs.createReadStream(expectedSegmentFilePath);
                                                const outputStream = fs.createWriteStream(sourceFilePath, {flags: 'a'});
                                                
                                                outputStream.on('close', function() {
                                                    //fs.unlinkSync(expectedSegmentFilePath);
                                                });

                                                inputStream.on('error', error => {
                                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                                });

                                                inputStream.pipe(outputStream)
                                                .on('error', error => {
                                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                                });
                                            }
                                        }
                                    })
                                    .catch(error => {
                                        logDebugMessageToConsole(null, error, new Error().stack, true);
                                    });
                                    
                                    node_getVideoBandwidth(jwtToken, videoId)
                                    .then(nodeResponseData => {
                                        if(nodeResponseData.isError) {
                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                        }
                                        else {
                                            const bandwidth = nodeResponseData.bandwidth;
                                            
                                            websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: {type: 'streaming', videoId: videoId, lengthTimestamp: lengthTimestamp, bandwidth: bandwidth}}});
                                        }
                                    })
                                    .catch(error => {
                                        logDebugMessageToConsole(null, error, new Error().stack, true);
                                    });
                                    
                                    if(!isRecordingStreamRemotely) {
                                        const segmentIndexToRemove = nextExpectedSegmentIndex - 20;
                                        
                                        if(segmentIndexToRemove >= 0) {
                                            const segmentName = 'segment-' + resolution + '-' + segmentIndexToRemove + '.ts';
                                            
                                            node_removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName)
                                            .then(nodeResponseData => {
                                                if(nodeResponseData.isError) {
                                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                }
                                                else {
                                                    logDebugMessageToConsole('segment removed: ' + segmentName, null, null, true);
                                                }
                                            })
                                            .catch(error => {
                                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                            });
                                        }
                                    }

                                    // update thumbnail, preview, and poster every 10 seconds
                                    if(!uploadingThumbnail && !uploadingPreview && !uploadingPoster && (Date.now() - lastVideoImagesUpdateTimestamp > 10000)) {
                                        lastVideoImagesUpdateTimestamp = Date.now();

                                        const imagesDirectoryPath = path.join(getAppDataVideosDirectoryPath(), videoId + '/images');
                                        const sourceImagePath = path.join(imagesDirectoryPath, 'source.jpg');
                                        
                                        let process = spawn(getFfmpegPath(), [
                                            '-i', expectedSegmentFilePath,
                                            '-ss', '0.5',
                                            '-q', '18',
                                            '-frames:v', '1', 
                                            '-y',
                                            sourceImagePath,
                                        ]);
                                        
                                        process.on('spawn', function (code) {
                                            logDebugMessageToConsole('live source image generating ffmpeg process spawned', null, null, true);
                                        });
                                        
                                        process.on('exit', function (code) {
                                            logDebugMessageToConsole('live source image generating ffmpeg process exited with exit code: ' + code, null, null, true);
    
                                            if(code === 0) {
                                                if(fs.existsSync(sourceImagePath)) {
                                                    logDebugMessageToConsole('generated live source image for video: ' + videoId, null, null, true);
    
                                                    uploadingThumbnail = true;
                                                    uploadingPreview = true;
                                                    uploadingPoster = true;
    
                                                    const thumbnailImagePath = path.join(imagesDirectoryPath, 'thumbnail.jpg');
                                                    const previewImagePath = path.join(imagesDirectoryPath, 'preview.jpg');
                                                    const posterImagePath = path.join(imagesDirectoryPath, 'poster.jpg');
    
                                                    sharp(sourceImagePath).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toFile(thumbnailImagePath)
                                                    .then(() => {
                                                        node_setThumbnail(jwtToken, videoId, thumbnailImagePath)
                                                        .then(nodeResponseData => {
                                                            if(nodeResponseData.isError) {
                                                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                            }
                                                        })
                                                        .catch(error => {
                                                            logDebugMessageToConsole(null, error, new Error().stack, true);
                                                        })
                                                        .finally(() => {
                                                            uploadingThumbnail = false;
                                                        });
                                                    })
                                                    .catch(error => {
                                                        logDebugMessageToConsole(null, error, new Error().stack, true);
    
                                                        uploadingThumbnail = false;
                                                    });
    
                                                    sharp(sourceImagePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toFile(previewImagePath)
                                                    .then(() => {
                                                        node_setPreview(jwtToken, videoId, previewImagePath)
                                                        .then(nodeResponseData => {
                                                            if(nodeResponseData.isError) {
                                                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                            }
                                                        })
                                                        .catch(error => {
                                                            logDebugMessageToConsole(null, error, new Error().stack, true);
                                                        })
                                                        .finally(() => {
                                                            uploadingPreview = false;
                                                        });
                                                    })
                                                    .catch(error => {
                                                        logDebugMessageToConsole(null, error, new Error().stack, true);
    
                                                        uploadingPreview = false;
                                                    });
    
                                                    sharp(sourceImagePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toFile(posterImagePath)
                                                    .then(() => {
                                                        node_setPoster(jwtToken, videoId, posterImagePath)
                                                        .then(nodeResponseData => {
                                                            if(nodeResponseData.isError) {
                                                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                            }
                                                        })
                                                        .catch(error => {
                                                            logDebugMessageToConsole(null, error, new Error().stack, true);
                                                        })
                                                        .finally(() => {
                                                            uploadingPoster = false;
                                                        });
                                                    })
                                                    .catch(error => {
                                                        logDebugMessageToConsole(null, error, new Error().stack, true);
    
                                                        uploadingPoster = false;
                                                    });
                                                } else {
                                                    logDebugMessageToConsole('expected a live source image to be generated in <' + sourceImagePath + '> but found none', null, null, true);
                                                }
                                            }
                                            else {
                                                logDebugMessageToConsole('live source image generating exited with code: ' + code, null, null, true);
                                            }
                                        });
                                        
                                        process.on('error', function (code) {
                                            logDebugMessageToConsole('live source image generating errorred with error code: ' + code, null, null, true);
                                        });
                                    }
                                }
                            }
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                        });
                    })();
                }
                else {
                    if(segmentInterval != null) {
                        clearInterval(segmentInterval);
                    }
                }
            }, 250);
        });
        
        process.on('exit', function (code) {
            logDebugMessageToConsole('performStreamingJob live stream process exited with exit code: ' + code, null, null, true);
            
            if(segmentInterval != null) {
                clearInterval(segmentInterval);
            }
            
            if(liveStreamExists(videoId)) {
                logDebugMessageToConsole('performStreamingJob checking if live stream process was interrupted by MoarTube Client...', null, null, true);
                
                if(!isLiveStreamStopping(videoId)) {
                    logDebugMessageToConsole('performStreamingJob determined live stream process was not interrupted by MoarTube Client', null, null, true);
                    
                    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopping', videoId: videoId }}});
                    
                    node_stopVideoStreaming(jwtToken, videoId)
                    .then((nodeResponseData) => {
                        if(nodeResponseData.isError) {
                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        }
                        else {
                            websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopped', videoId: videoId }}});
                        }
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                    });
                }
                else {
                    logDebugMessageToConsole('performStreamingJob determined live stream process was interrupted by MoarTube Client', null, null, true);
                }
            }
        });
        
        process.on('error', function (code) {
            logDebugMessageToConsole('performEncodingJob errored with error code: ' + code, null, null, true);
            
            if(segmentInterval != null) {
                clearInterval(segmentInterval);
            }
        });
        
        resolve({isError: false});
    });
}

function generateFfmpegLiveArguments(videoId, resolution, format, rtmpUrl, isRecordingStreamRemotely) {
    //let width;
    //let height;
    let bitrate;
    let gop;
    let framerate;
    let segmentLength;
    //let bufsize;

    const clientSettings = getClientSettings();
    
    /*
    if(resolution === '2160p') {
        width = '3840';
        height = '2160';
    }
    else if(resolution === '1440p') {
        width = '2560';
        height = '1440';
    }
    else if(resolution === '1080p') {
        width = '1920';
        height = '1080';
    }
    else if(resolution === '720p') {
        width = '1280';
        height = '720';
    }
    else if(resolution === '480p') {
        width = '854';
        height = '480';
    }
    else if(resolution === '360p') {
        width = '640';
        height = '360';
    }
    else if(resolution === '240p') {
        width = '426';
        height = '240';
    }
    */
   
    if(format === 'm3u8') {
        bitrate = clientSettings.liveEncoderSettings.hls[resolution + '-bitrate'] + 'k';
        gop = clientSettings.liveEncoderSettings.hls.gop;
        framerate = clientSettings.liveEncoderSettings.hls.framerate;
        segmentLength = clientSettings.liveEncoderSettings.hls.segmentLength;

        //bufsize = (Number(clientSettings.liveEncoderSettings.hls[resolution + '-bitrate']) * (Number(segmentLength) * 2)) + 'k';
    }

    /*
    // NOTE: best not to assume the streamer's preferences and just let them decide 
    // picture formatting from their broadcasting software

    let scale = '';

    if(clientSettings.processingAgent.processingAgentType === 'cpu') {
        scale = 'scale';
    }
    else if(clientSettings.processingAgent.processingAgentType === 'gpu' && (format === 'm3u8')) {
        if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
            scale = 'scale_cuda';
        }
        else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
            scale = 'scale';
        }
    }

    let filterComplex = scale + "='if(gt(ih,iw),-1," + width + ")':'if(gt(ih,iw)," + height + ",-1)',";
    
    if(clientSettings.processingAgent.processingAgentType === 'cpu') {
        filterComplex += 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
    }
    else if(clientSettings.processingAgent.processingAgentType === 'gpu' && (format === 'm3u8')) {
        if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
            filterComplex += 'hwdownload,format=nv12,crop=trunc(iw/2)*2:trunc(ih/2)*2,hwupload_cuda';
        }
        else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
            filterComplex += 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
        }
    }
    */
    
    const hlsSegmentOutputPath = path.join(getAppDataVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts');
    const manifestFilePath = path.join(getAppDataVideosDirectoryPath(), videoId + '/adaptive/m3u8/manifest-' + resolution + '.m3u8');
    
    let ffmpegArguments = [];

    /*
    -g
    GOP size = (frame rate) * (segment length)
    60fps video will contain 2 key frames per 1-second segment,
    file size and encoding performance appears not too affected by this.
    Source RTMP frame rate must be a multiple of 30.
    */

    if(clientSettings.processingAgent.processingAgentType === 'cpu') {
        if(format === 'm3u8') {
            ffmpegArguments = [
                '-listen', '1',
                '-timeout', '10000',
                '-f', 'flv',
                '-i', rtmpUrl,
                '-c:v', 'libx264', '-b:v', bitrate,
                '-sc_threshold', '0',
                '-g', gop,
                '-r', framerate,
                '-c:a', 'aac',
                '-f', 'hls', 
                '-hls_time', segmentLength, '-hls_list_size', '20',
                '-hls_segment_filename', hlsSegmentOutputPath,
                '-hls_base_url', `/assets/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                '-hls_playlist_type', 'event', 
                '-hls_flags', 'append_list',
                manifestFilePath
            ];
        }
    }
    else if(clientSettings.processingAgent.processingAgentType === 'gpu') {
        if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
            if(format === 'm3u8') {
                ffmpegArguments = [
                    '-listen', '1',
                    '-timeout', '10000',
                    '-hwaccel', 'cuvid',
                    '-hwaccel_output_format', 'cuda',
                    '-f', 'flv',
                    '-i', rtmpUrl, 
                    '-c:v', 'h264_nvenc', '-b:v', bitrate,
                    '-sc_threshold', '0',
                    '-g', gop,
                    '-r', framerate,
                    '-c:a', 'aac',
                    '-f', 'hls', 
                    '-hls_time', segmentLength, '-hls_list_size', '20',
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `/assets/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'event', 
                    '-hls_flags', 'append_list',
                    manifestFilePath
                ];
            }
        }
        else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
            if(format === 'm3u8') {
                ffmpegArguments = [
                    '-listen', '1',
                    '-timeout', '10000',
                    '-hwaccel', 'dxva2',
                    '-hwaccel_device', '0',
                    '-f', 'flv',
                    '-i', rtmpUrl,
                    '-c:v', 'h264_amf', '-b:v', bitrate,
                    '-sc_threshold', '0',
                    '-g', gop,
                    '-r', framerate,
                    '-c:a', 'aac',
                    '-f', 'hls', 
                    '-hls_time', segmentLength, '-hls_list_size', '20',
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `/assets/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'event', 
                    '-hls_flags', 'append_list',
                    manifestFilePath
                ];
            }
        }
    }
    
    /*
    hls_list_size will be enforced if not recording remotely, otherwise hls_list_size will be 0 (no list size limit) if stream is recording remotely
    */
    if(!isRecordingStreamRemotely) {
        ffmpegArguments.splice(ffmpegArguments.indexOf('-hls_playlist_type'), 1);
        ffmpegArguments.splice(ffmpegArguments.indexOf('event'), 1);
    }
    
    return ffmpegArguments;
}

module.exports = {
    performStreamingJob
};