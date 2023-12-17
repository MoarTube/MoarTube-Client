const { node_setVideoPublishing, node_setVideoLengths, node_setVideoPublished, node_broadcastMessage_websocket } = require('../utils/node-communications');
const { logDebugMessageToConsole, deleteDirectoryRecursive, timestampToSeconds } = require('../utils/helpers');

var inProgressPublishingJobCount = 0;
var maximumInProgressPublishingJobCount = 5;

const inProgressPublishingJobs = [];
const pendingPublishingJobs = [];
const publishVideoEncodingTracker = {};

function startPublishInterval() {
    setInterval(function() {
        while(pendingPublishingJobs.length > 0 && inProgressPublishingJobCount < maximumInProgressPublishingJobCount) {
            inProgressPublishingJobCount++;
            
            inProgressPublishingJobs.push(pendingPublishingJobs.shift());
            
            startPublishingJob(inProgressPublishingJobs[inProgressPublishingJobs.length - 1])
            .then((completedPublishingJob) => {
                logDebugMessageToConsole('completed publishing job: ' + completedPublishingJob, null, null, true);

                const index = inProgressPublishingJobs.findIndex(function(inProgressPublishingJob) {
                    return inProgressPublishingJob.videoId === completedPublishingJob.videoId && inProgressPublishingJob.format === completedPublishingJob.format && inProgressPublishingJob.resolution === completedPublishingJob.resolution;
                });
                
                inProgressPublishingJobs.splice(index, 1);
                
                const videoIdHasPendingPublishingJobExists = pendingPublishingJobs.some((pendingPublishingJob) => pendingPublishingJob.hasOwnProperty('videoId') && pendingPublishingJob.videoId === completedPublishingJob.videoId);
                const videoIdHasInProgressPublishingJobExists = inProgressPublishingJobs.some((inProgressPublishingJob) => inProgressPublishingJob.hasOwnProperty('videoId') && inProgressPublishingJob.videoId === completedPublishingJob.videoId);
                
                if(!videoIdHasPendingPublishingJobExists && !videoIdHasInProgressPublishingJobExists) {
                    finishVideoPublish(completedPublishingJob.jwtToken, completedPublishingJob.videoId, completedPublishingJob.sourceFileExtension);
                }
                
                inProgressPublishingJobCount--;
            });
        }
    }, 3000);
}

function startPublishingJob(publishingJob) {
    return new Promise(function(resolve, reject) {
        const jwtToken = publishingJob.jwtToken;
        const videoId = publishingJob.videoId;
        const format = publishingJob.format;
        const resolution = publishingJob.resolution;
        const sourceFileExtension = publishingJob.sourceFileExtension;
        const idleInterval = publishingJob.idleInterval;

        clearInterval(idleInterval);
        
        node_setVideoPublishing(jwtToken, videoId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                resolve(publishingJob);
            }
            else {
                publishVideoEncodingTracker[videoId] = {processes: [], stopping: false};
                
                performEncodingJob(jwtToken, videoId, format, resolution, sourceFileExtension)
                .then((data) => {
                    performUploadingJob(jwtToken, videoId, format, resolution)
                    .then((data) => {
                        resolve(publishingJob);
                    })
                    .catch(error => {
                        resolve(publishingJob);
                    });
                })
                .catch(error => {
                    resolve(publishingJob);
                });
            }
        });
    });
}

function finishVideoPublish(jwtToken, videoId, sourceFileExtension) {
    deleteDirectoryRecursive(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive'));
    deleteDirectoryRecursive(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive'));
    
    const sourceFilePath =  path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/source/' + videoId + sourceFileExtension);
    
    if(fs.existsSync(sourceFilePath)) {
        const result = spawnSync(ffmpegPath, [
            '-i', sourceFilePath
        ], 
        {encoding: 'utf-8' }
        );
        
        const durationIndex = result.stderr.indexOf('Duration: ');
        const lengthTimestamp = result.stderr.substr(durationIndex + 10, 11);
        const lengthSeconds = timestampToSeconds(lengthTimestamp);
        
        node_setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            }
            else {
                node_setVideoPublished(jwtToken, videoId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    }
                    else {
                        logDebugMessageToConsole('video finished publishing for id: ' + videoId, null, null, true);
                        
                        node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'published', videoId: videoId, lengthTimestamp: lengthTimestamp, lengthSeconds: lengthSeconds }}});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                });
            }
        })
        .catch(error => {
            logDebugMessageToConsole(null, error, new Error().stack, true);
        });
    }
    else {
        logDebugMessageToConsole('expected video source file to be in <' + sourceFilePath + '> but found none', null, null, true);
    }
}

function performEncodingJob(jwtToken, videoId, format, resolution, sourceFileExtension) {
    return new Promise(function(resolve, reject) {
        if(!publishVideoEncodingTracker[videoId].stopping) {
            const sourceFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/source/' + videoId + sourceFileExtension);
            
            const destinationFileExtension = '.' + format;
            var destinationFilePath = '';
            
            if(format === 'm3u8') {
                fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/manifest-' + resolution + destinationFileExtension);
            }
            else if(format === 'mp4') {
                fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/mp4/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/mp4/' + resolution + '/' + resolution + destinationFileExtension);
            }
            else if(format === 'webm') {
                fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/webm/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/webm/' + resolution + '/' + resolution + destinationFileExtension);
            }
            else if(format === 'ogv') {
                fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/ogv/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/ogv/' + resolution + '/' + resolution + destinationFileExtension);
            }
            
            const ffmpegArguments = generateFfmpegVideoArguments(videoId, resolution, format, sourceFilePath, destinationFilePath);
            
            const process = spawn(ffmpegPath, ffmpegArguments);
            
            publishVideoEncodingTracker[videoId].processes.push(process);
            
            process.stdout.on('data', function (data) {
                const output = Buffer.from(data).toString();
                logDebugMessageToConsole(output, null, null, true);
            });
            
            var lengthTimestamp = '00:00:00.00';
            var lengthSeconds = 0;
            var currentTimeSeconds = 0;
            
            var stderrOutput = '';
            process.stderr.on('data', function (data) {
                if(!publishVideoEncodingTracker[videoId].stopping) {
                    const stderrTemp = Buffer.from(data).toString();
                    
                    logDebugMessageToConsole(stderrTemp, null, null, false);
                    
                    if(stderrTemp.indexOf('time=') != -1) {
                        logDebugMessageToConsole(stderrTemp, null, null, true);
                        
                        if(lengthSeconds === 0) {
                            var index = stderrOutput.indexOf('Duration: ');
                            lengthTimestamp = stderrOutput.substr(index + 10, 11);
                            lengthSeconds = timestampToSeconds(lengthTimestamp);
                        }
                        
                        var index = stderrTemp.indexOf('time=');
                        var currentTimestamp = stderrTemp.substr(index + 5, 11);
                        
                        currentTimeSeconds = timestampToSeconds(currentTimestamp);
                    }
                    else {
                        stderrOutput += stderrTemp;
                    }
                    
                    // no need to rate limit; interval is approximately 1 second
                    if(currentTimeSeconds > 0 && lengthSeconds > 0) {
                        const encodingProgress = Math.ceil(((currentTimeSeconds / lengthSeconds) * 100) / 2);
                        
                        node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing', videoId: videoId, format: format, resolution: resolution, progress: encodingProgress }}});
                    }
                }
            });
            
            process.on('spawn', function (code) {
                logDebugMessageToConsole('performEncodingJob ffmpeg process spawned with arguments: ' + ffmpegArguments, null, null, true);
            });
            
            process.on('exit', function (code) {
                logDebugMessageToConsole('performEncodingJob ffmpeg process exited with exit code: ' + code, null, null, true);
                
                if(code === 0) {
                    resolve({jwtToken: jwtToken, videoId: videoId, format: format, resolution: resolution});
                }
                else {
                    reject({isError: true, message: 'encoding process ended with an error code: ' + code});
                }
            });
            
            process.on('error', function (code) {
                logDebugMessageToConsole('performEncodingJob errorred with error code: ' + code, null, null, true);
            });
        }
        else {
            reject({isError: true, message: videoId + ' attempted to encode but publishing is stopping'});
        }
    });
}

function performUploadingJob(jwtToken, videoId, format, resolution) {
    return new Promise(function(resolve, reject) {			
        if(!publishVideoEncodingTracker[videoId].stopping) {
            const paths = [];
            
            if(format === 'm3u8') {
                const manifestFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/manifest-' + resolution + '.m3u8');
                const segmentsDirectoryPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/' + resolution);
                
                paths.push({fileName : 'manifest-' + resolution + '.m3u8', filePath: manifestFilePath});
                
                fs.readdirSync(segmentsDirectoryPath).forEach(fileName => {
                    const segmentFilePath = segmentsDirectoryPath + '/' + fileName;
                    if (!fs.statSync(segmentFilePath).isDirectory()) {
                        paths.push({fileName : fileName, filePath: segmentFilePath});
                    }
                });
            }
            else if(format === 'mp4') {
                const fileName = resolution + '.mp4';
                const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/mp4/' + resolution + '/' + fileName);
                
                paths.push({fileName : fileName, filePath: filePath});
            }
            else if(format === 'webm') {
                const fileName = resolution + '.webm';
                const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/webm/' + resolution + '/' + fileName);
                
                paths.push({fileName : fileName, filePath: filePath});
            }
            else if(format === 'ogv') {
                const fileName = resolution + '.ogv';
                const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/ogv/' + resolution + '/' + fileName);
                
                paths.push({fileName : fileName, filePath: filePath});
            }
            
            node_uploadVideo_fileSystem(jwtToken, videoId, format, resolution, paths)
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    reject({isError: true, message: 'error communicating with the MoarTube node'});
                }
                else {
                    resolve({isError: false});
                }
                
                for(const path of paths) {
                    if(fs.existsSync(path.filePath)) {
                        fs.unlinkSync(path.filePath);
                    }
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                reject({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
        else {
            reject({isError: true, message: videoId + ' attempted to upload but publishing is stopping'});
        }
    });
}

function generateFfmpegVideoArguments(videoId, resolution, format, sourceFilePath, destinationFilePath) {
    var scale = '';
    var width = '';
    var height = '';
    var bitrate = '';
    
    if(resolution === '2160p') {
        width = '3840';
        height = '2160';
        bitrate = '10000k';
    }
    else if(resolution === '1440p') {
        width = '2560';
        height = '1440';
        bitrate = '8000k';
    }
    else if(resolution === '1080p') {
        width = '1920';
        height = '1080';
        bitrate = '6000k';
    }
    else if(resolution === '720p') {
        width = '1280';
        height = '720';
        bitrate = '4000k';
    }
    else if(resolution === '480p') {
        width = '854';
        height = '480';
        bitrate = '2000k';
    }
    else if(resolution === '360p') {
        width = '640';
        height = '360';
        bitrate = '1500k';
    }
    else if(resolution === '240p') {
        width = '426';
        height = '240';
        bitrate = '700k';
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
    
    var filterComplex = scale + "='if(gt(ih,iw),-1," + width + ")':'if(gt(ih,iw)," + height + ",-1)',";
    
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

    const hlsSegmentOutputPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts');
    
    var ffmpegArguments = [];
    
    if(clientSettings.processingAgent.processingAgentType === 'cpu') {
        if(format === 'm3u8') {
            ffmpegArguments = [
                '-i', sourceFilePath,
                '-r', '30',
                '-c:a', 'aac',
                '-c:v', 'libx264', '-b:v', bitrate,
                '-profile:v', 'high',
                '-sc_threshold', '0',
                '-g', '180',
                '-vf', filterComplex,
                '-f', 'hls', 
                '-hls_time', '6', '-hls_init_time', '2',
                '-hls_segment_filename', hlsSegmentOutputPath, 
                '-hls_base_url', '/' + videoId + '/adaptive/m3u8/' + resolution + '/segments/', 
                '-hls_playlist_type', 'vod',
                destinationFilePath
            ];
        }
        else if(format === 'mp4') {
            ffmpegArguments = [
                '-i', sourceFilePath,
                '-r', '30',
                '-c:a', 'aac',
                '-c:v', 'libx264', '-b:v', bitrate,
                '-vf', filterComplex,
                '-movflags', 'faststart',
                '-y',
                destinationFilePath
            ];
        }
        else if(format === 'webm') {
            ffmpegArguments = [
                '-i', sourceFilePath,
                '-r', '30',
                '-c:a', 'libopus',
                '-c:v', 'libvpx-vp9', '-b:v', bitrate,
                '-vf', filterComplex,
                '-y',
                destinationFilePath
            ];
        }
        else if(format === 'ogv') {
            ffmpegArguments = [
                '-i', sourceFilePath,
                '-r', '30',
                '-c:a', 'libopus',
                '-c:v', 'libvpx', '-b:v', bitrate,
                '-vf', filterComplex,
                '-y',
                destinationFilePath
            ];
        }
    }
    else if(clientSettings.processingAgent.processingAgentType === 'gpu') {
        if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
            if(format === 'm3u8') {
                ffmpegArguments = [
                    '-hwaccel', 'cuvid',
                    '-hwaccel_output_format', 'cuda',
                    '-i', sourceFilePath,
                    '-r', '30',
                    '-c:a', 'aac',
                    '-c:v', 'h264_nvenc', '-b:v', bitrate,
                    '-profile:v', 'high',
                    '-preset', 'p6',
                    '-sc_threshold', '0',
                    '-g', '180',
                    '-vf', filterComplex,
                    '-f', 'hls',
                    '-hls_time', '6', '-hls_init_time', '2',
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'vod',
                    destinationFilePath
                ];
            }
            else if(format === 'mp4') {
                ffmpegArguments = [
                    '-hwaccel', 'cuvid',
                    '-hwaccel_output_format', 'cuda',
                    '-i', sourceFilePath,
                    '-r', '30',
                    '-c:a', 'aac',
                    '-c:v', 'h264_nvenc', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-movflags', 'faststart',
                    '-y',
                    destinationFilePath
                ];
            }
            else if(format === 'webm') {
                ffmpegArguments = [
                    '-i', sourceFilePath,
                    '-r', '30',
                    '-c:a', 'libopus',
                    '-c:v', 'libvpx-vp9', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-y',
                    destinationFilePath
                ];
            }
            else if(format === 'ogv') {
                ffmpegArguments = [
                    '-i', sourceFilePath,
                    '-r', '30',
                    '-c:a', 'libopus',
                    '-c:v', 'libvpx', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-y',
                    destinationFilePath
                ];
            }
        }
        else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
            if(format === 'm3u8') {
                ffmpegArguments = [
                    '-hwaccel', 'dxva2',
                    '-hwaccel_device', '0',
                    '-i', sourceFilePath,
                    '-r', '30',
                    '-c:a', 'aac',
                    '-c:v', 'h264_amf', '-b:v', bitrate,
                    '-sc_threshold', '0',
                    '-g', '180',
                    '-vf', filterComplex,
                    '-f', 'hls',
                    '-hls_time', '6', '-hls_init_time', '2',
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'vod',
                    destinationFilePath
                ];
            }
            else if(format === 'mp4') {
                ffmpegArguments = [
                    '-hwaccel', 'dxva2',
                    '-hwaccel_device', '0',
                    '-i', sourceFilePath,
                    '-r', '30',
                    '-c:a', 'aac',
                    '-c:v', 'h264_amf', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-movflags', 'faststart',
                    '-y',
                    destinationFilePath
                ];
            }
            else if(format === 'webm') {
                ffmpegArguments = [
                    '-i', sourceFilePath,
                    '-r', '30',
                    '-c:a', 'libopus',
                    '-c:v', 'libvpx-vp9', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-y',
                    destinationFilePath
                ];
            }
            else if(format === 'ogv') {
                ffmpegArguments = [
                    '-i', sourceFilePath,
                    '-r', '30',
                    '-c:a', 'libopus',
                    '-c:v', 'libvpx', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-y',
                    destinationFilePath
                ];
            }
        }
    }
    
    return ffmpegArguments;
}


module.exports = {
    startPublishInterval
};