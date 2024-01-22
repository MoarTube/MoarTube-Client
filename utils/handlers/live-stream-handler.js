const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;

const { logDebugMessageToConsole, getTempVideosDirectoryPath, websocketClientBroadcast, getFfmpegPath, getClientSettings, timestampToSeconds } = require('../helpers');
const { node_setVideoLengths, node_getNextExpectedSegmentIndex, node_setThumbnail, node_setPreview, node_setPoster, node_uploadStream, node_getVideoBandwidth, 
    node_removeAdaptiveStreamSegment, node_stopVideoStreaming } = require('../node-communications');
const { addProcessToLiveStreamTracker, isLiveStreamStopping, liveStreamExists } = require('../trackers/live-stream-tracker');

function performStreamingJob(jwtToken, videoId, title, description, tags, rtmpUrl, format, resolution, isRecordingStreamRemotely, isRecordingStreamLocally) {
    return new Promise(function(resolve, reject) {
        logDebugMessageToConsole('starting live stream for id: ' + videoId, null, null, true);
        
        fs.mkdirSync(path.join(getTempVideosDirectoryPath(), videoId + '/source'), { recursive: true });
        fs.mkdirSync(path.join(getTempVideosDirectoryPath(), videoId + '/images'), { recursive: true });
        fs.mkdirSync(path.join(getTempVideosDirectoryPath(), videoId + '/adaptive'), { recursive: true });
        fs.mkdirSync(path.join(getTempVideosDirectoryPath(), videoId + '/progressive'), { recursive: true });
        
        const sourceDirectoryPath = path.join(getTempVideosDirectoryPath(), videoId + '/source');
        const sourceFilePath = path.join(sourceDirectoryPath, '/' + videoId + '.ts');
        const videoDirectory = path.join(getTempVideosDirectoryPath(), videoId + '/adaptive/m3u8');
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
            
            segmentInterval = setInterval(function() {
                if(!isLiveStreamStopping(videoId)) {
                    (function() {
                        node_getNextExpectedSegmentIndex(jwtToken, videoId, format, resolution)
                        .then(nodeResponseData => {
                            if(nodeResponseData.isError) {
                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
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
                                    
                                    const imagesDirectoryPath = path.join(getTempVideosDirectoryPath(), videoId + '/images');
                                    
                                    const thumbnailImagePath = path.join(imagesDirectoryPath, 'thumbnail.jpg');
                                    
                                    let process1 = spawn(getFfmpegPath(), [
                                        '-i', expectedSegmentFilePath, 
                                        '-vf', 'select=\'gte(t,3*25/100)\',crop=min(iw\\,ih):min(iw\\,ih),scale=100:100,setsar=1',
                                        '-vframes', '1',
                                        '-y',
                                        thumbnailImagePath
                                    ]);
                                    
                                    process1.on('spawn', function (code) {
                                        logDebugMessageToConsole('live thumbnail generating ffmpeg process spawned', null, null, true);
                                    });
                                    
                                    process1.on('exit', function (code) {
                                        logDebugMessageToConsole('live thumbnail generating ffmpeg process exited with exit code: ' + code, null, null, true);
                                        
                                        if(code === 0) {
                                            const thumbnailPath = path.join(getTempVideosDirectoryPath(), videoId + '/images/thumbnail.jpg');
                                            
                                            if(fs.existsSync(thumbnailPath)) {
                                                logDebugMessageToConsole('generated live thumbnail for video: ' + videoId, null, null, true);
                                                
                                                logDebugMessageToConsole('uploading live thumbnail to node for video: ' + videoId, null, null, true);
                                                
                                                node_setThumbnail(jwtToken, videoId, thumbnailPath)
                                                .then(nodeResponseData => {
                                                    if(nodeResponseData.isError) {
                                                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                    }
                                                    else {
                                                        logDebugMessageToConsole('uploaded live thumbnail to node for video: ' + videoId, null, null, true);
                                                        
                                                        //fs.unlinkSync(thumbnailPath);
                                                    }
                                                })
                                                .catch(error => {
                                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                                });
                                            } else {
                                                logDebugMessageToConsole('expected a live thumbnail to be generated in <' + thumbnailPath + '> but found none', null, null, true);
                                            }
                                        }
                                        else {
                                            logDebugMessageToConsole('live thumbnail generating exited with code: ' + code, null, null, true);
                                        }
                                    });
                                    
                                    process1.on('error', function (code) {
                                        logDebugMessageToConsole('live thumbnail generating errorred with error code: ' + code, null, null, true);
                                    });

                                    const previewImagePath = path.join(imagesDirectoryPath, 'preview.jpg');
                                    
                                    let process2 = spawn(getFfmpegPath(), [
                                        '-i', expectedSegmentFilePath, 
                                        '-vf', 'select=\'gte(t,3*25/100)\',scale=512:288:force_original_aspect_ratio=decrease,pad=512:288:(ow-iw)/2:(oh-ih)/2,setsar=1',
                                        '-vframes', '1',
                                        '-y',
                                        previewImagePath
                                    ]);
                                    
                                    process2.on('spawn', function (code) {
                                        logDebugMessageToConsole('live preview generating ffmpeg process spawned', null, null, true);
                                    });
                                    
                                    process2.on('exit', function (code) {
                                        logDebugMessageToConsole('live preview generating ffmpeg process exited with exit code: ' + code, null, null, true);
                                        
                                        if(code === 0) {
                                            const previewPath = path.join(getTempVideosDirectoryPath(), videoId + '/images/preview.jpg');
                                            
                                            if(fs.existsSync(previewPath)) {
                                                logDebugMessageToConsole('generated live preview for video: ' + videoId, null, null, true);
                                                
                                                logDebugMessageToConsole('uploading live preview to node for video: ' + videoId, null, null, true);
                                                
                                                node_setPreview(jwtToken, videoId, previewPath)
                                                .then(nodeResponseData => {
                                                    if(nodeResponseData.isError) {
                                                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                    }
                                                    else {
                                                        logDebugMessageToConsole('uploaded live preview to node for video: ' + videoId, null, null, true);
                                                        
                                                        //fs.unlinkSync(previewPath);
                                                    }
                                                })
                                                .catch(error => {
                                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                                });
                                            } else {
                                                logDebugMessageToConsole('expected a live preview to be generated in <' + previewPath + '> but found none', null, null, true);
                                            }
                                        }
                                        else {
                                            logDebugMessageToConsole('live preview generating exited with code: ' + code, null, null, true);
                                        }
                                    });
                                    
                                    process2.on('error', function (code) {
                                        logDebugMessageToConsole('live preview generating errorred with error code: ' + code, null, null, true);
                                    });

                                    const posterImagePath = path.join(imagesDirectoryPath, 'poster.jpg');
                                    
                                    let process3 = spawn(getFfmpegPath(), [
                                        '-i', expectedSegmentFilePath, 
                                        '-vf', 'select=\'gte(t,3*25/100)\',scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
                                        '-vframes', '1',
                                        '-y',
                                        posterImagePath
                                    ]);
                                
                                    process3.on('spawn', function (code) {
                                        logDebugMessageToConsole('live poster generating ffmpeg process spawned', null, null, true);
                                    });
                                    
                                    process3.on('exit', function (code) {
                                        logDebugMessageToConsole('live poster generating ffmpeg process exited with exit code: ' + code, null, null, true);
                                        
                                        if(code === 0) {
                                            const posterPath = path.join(getTempVideosDirectoryPath(), videoId + '/images/poster.jpg');
                                            
                                            if(fs.existsSync(posterPath)) {
                                                logDebugMessageToConsole('generated live poster for video: ' + videoId, null, null, true);
                                                
                                                logDebugMessageToConsole('uploading live poster to node for video: ' + videoId, null, null, true);
                                                
                                                node_setPoster(jwtToken, videoId, posterPath)
                                                .then(nodeResponseData => {
                                                    if(nodeResponseData.isError) {
                                                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                    }
                                                    else {
                                                        logDebugMessageToConsole('uploaded live poster to node for video: ' + videoId, null, null, true);
                                                        
                                                        //fs.unlinkSync(posterPath);
                                                    }
                                                })
                                                .catch(error => {
                                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                                });
                                            } else {
                                                logDebugMessageToConsole('expected a live poster to be generated in <' + posterPath + '> but found none', null, null, true);
                                            }
                                        }
                                        else {
                                            logDebugMessageToConsole('live poster generating exited with code: ' + code, null, null, true);
                                        }
                                    });
                                    
                                    process3.on('error', function (code) {
                                        logDebugMessageToConsole('live poster generating errorred with error code: ' + code, null, null, true);
                                    });

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
            }, 500);
        });
        
        process.on('exit', function (code) {
            logDebugMessageToConsole('performStreamingJob live stream process exited with exit code: ' + code, null, null, true);
            
            if(segmentInterval != null) {
                clearInterval(segmentInterval);
            }
            
            if(liveStreamExists(videoId)) {
                logDebugMessageToConsole('performStreamingJob checking if live stream process was interrupted by user...', null, null, true);
                
                if(!isLiveStreamStopping(videoId)) {
                    logDebugMessageToConsole('performStreamingJob determined live stream process was interrupted by user', null, null, true);
                    
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
                    logDebugMessageToConsole('performStreamingJob determined live stream process was interrupted by user', null, null, true);
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
    let scale = '';
    let width = '';
    let height = '';
    let bitrate = '';
    
    if(resolution === '2160p') {
        width = '3840';
        height = '2160';
        bitrate = '12000k';
    }
    else if(resolution === '1440p') {
        width = '2560';
        height = '1440';
        bitrate = '10000k';
    }
    else if(resolution === '1080p') {
        width = '1920';
        height = '1080';
        bitrate = '8000k';
    }
    else if(resolution === '720p') {
        width = '1280';
        height = '720';
        bitrate = '6000k';
    }
    else if(resolution === '480p') {
        width = '854';
        height = '480';
        bitrate = '3000k';
    }
    else if(resolution === '360p') {
        width = '640';
        height = '360';
        bitrate = '2000k';
    }
    else if(resolution === '240p') {
        width = '426';
        height = '240';
        bitrate = '1000k';
    }
    
    const clientSettings = getClientSettings();

    if(clientSettings.processingAgent.processingAgentType === 'cpu' || format === 'webm' || format === 'ogv') {
        scale = 'scale';
    }
    else if(clientSettings.processingAgent.processingAgentType === 'gpu' && (format === 'm3u8' || format === 'mp4')) {
        if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
            scale = 'scale_cuda';
        }
        else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
            scale = 'scale';
        }
    }
    
    let filterComplex = scale + "='if(gt(ih,iw),-1," + width + ")':'if(gt(ih,iw)," + height + ",-1)',";
    
    if(clientSettings.processingAgent.processingAgentType === 'cpu' || format === 'webm' || format === 'ogv') {
        filterComplex += 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
    }
    else if(clientSettings.processingAgent.processingAgentType === 'gpu' && (format === 'm3u8' || format === 'mp4')) {
        if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
            filterComplex += 'hwdownload,format=nv12,crop=trunc(iw/2)*2:trunc(ih/2)*2,hwupload_cuda';
        }
        else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
            filterComplex += 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
        }
    }

    
    const hlsSegmentOutputPath = path.join(getTempVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts');
    const manifestFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/adaptive/m3u8/manifest-' + resolution + '.m3u8');
    
    let ffmpegArguments = [];
    
    if(clientSettings.processingAgent.processingAgentType === 'cpu') {
        if(format === 'm3u8') {
            ffmpegArguments = [
                '-listen', '1',
                '-timeout', '10000',
                '-f', 'flv',
                '-i', rtmpUrl,
                '-c:v', 'libx264', '-b:v', bitrate,
                '-sc_threshold', '0',
                '-g', '90',  // GOP size = (frame rate) * (segment length)
                '-c:a', 'aac',
                '-f', 'hls', 
                '-hls_time', '3', '-hls_init_time', '3', '-hls_list_size', '20',
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
                    '-g', '90',  // GOP size = (frame rate) * (segment length)
                    '-c:a', 'aac',
                    '-f', 'hls', 
                    '-hls_time', '3', '-hls_init_time', '3', '-hls_list_size', '20',
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
                    '-g', '90',  // GOP size = (frame rate) * (segment length)
                    '-c:a', 'aac',
                    '-f', 'hls', 
                    '-hls_time', '3', '-hls_init_time', '3', '-hls_list_size', '20',
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