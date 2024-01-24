const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const spawnSync = require('child_process').spawnSync;

const { logDebugMessageToConsole, deleteDirectoryRecursive, timestampToSeconds, websocketClientBroadcast, getTempVideosDirectoryPath, getFfmpegPath, getClientSettings } = require('../helpers');
const { node_setVideoPublishing, node_setVideoLengths, node_setVideoPublished, node_uploadVideo } = require('../node-communications');
const { getPendingPublishVideoTracker, getPendingPublishVideoTrackerQueueSize, enqueuePendingPublishVideo, dequeuePendingPublishVideo } = require('../trackers/pending-publish-video-tracker');
const { addToPublishVideoEncodingTracker, isPublishVideoEncodingStopping, addProcessToPublishVideoEncodingTracker } = require('../trackers/publish-video-encoding-tracker');

let inProgressPublishingJobCount = 0;
let maximumInProgressPublishingJobCount = 5;

const inProgressPublishingJobs = [];

function startVideoPublishInterval() {
    setInterval(function() {
        while(getPendingPublishVideoTrackerQueueSize() > 0 && inProgressPublishingJobCount < maximumInProgressPublishingJobCount) {
            inProgressPublishingJobCount++;
            
            inProgressPublishingJobs.push(dequeuePendingPublishVideo());
            
            startPublishingJob(inProgressPublishingJobs[inProgressPublishingJobs.length - 1])
            .then((completedPublishingJob) => {
                logDebugMessageToConsole('completed publishing job: ' + completedPublishingJob, null, null, true);

                const index = findInProgressPublishJobIndex(completedPublishingJob);
                
                inProgressPublishingJobs.splice(index, 1);

                const videoIdHasPendingPublishingJobExists = getPendingPublishVideoTracker().some((pendingPublishingJob) => pendingPublishingJob.hasOwnProperty('videoId') && pendingPublishingJob.videoId === completedPublishingJob.videoId);
                const videoIdHasInProgressPublishingJobExists = inProgressPublishingJobs.some((inProgressPublishingJob) => inProgressPublishingJob.hasOwnProperty('videoId') && inProgressPublishingJob.videoId === completedPublishingJob.videoId);
                
                if(!videoIdHasPendingPublishingJobExists && !videoIdHasInProgressPublishingJobExists) {
                    finishVideoPublish(completedPublishingJob.jwtToken, completedPublishingJob.videoId, completedPublishingJob.sourceFileExtension);
                }
                
                inProgressPublishingJobCount--;

                /*
                If resource constraints was encountered, it was likely transient.
                Reset the maximum concurrent jobs allowed when no jobs remain.
                */
                if(inProgressPublishingJobCount === 0 && getPendingPublishVideoTrackerQueueSize() === 0) {
                    maximumInProgressPublishingJobCount = 5;
                }
            })
            .catch(failedPublishingJob => {
                /*
                Failure is likely due to resource constraints leading to ffmpeg process termination by the operating system.
                The assumption is likely correct, so we'll assume it 100% of the time to no ill effect.
                Lower the maximum concurrent jobs allowed and append the job to the end of the queue.
                The publish attempt will continue until the job is either successful or the user intervenes.
                */

                logDebugMessageToConsole('failed publishing job: ' + failedPublishingJob, null, null, true);

                const index = findInProgressPublishJobIndex(failedPublishingJob);

                inProgressPublishingJobs.splice(index, 1);

                const jwtToken = failedPublishingJob.jwtToken;
                const videoId = failedPublishingJob.videoId;
                const format = failedPublishingJob.format;
                const resolution = failedPublishingJob.resolution;

                failedPublishingJob.idleInterval = setInterval(function() {
                    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing', videoId: videoId, format: format, resolution: resolution, progress: 0 }}});
                }, 1000);

                enqueuePendingPublishVideo(failedPublishingJob);

                if(maximumInProgressPublishingJobCount > 1) {
                    maximumInProgressPublishingJobCount--;
                }

                inProgressPublishingJobCount--;
            });
        }
    }, 3000);
}

function findInProgressPublishJobIndex(completedPublishingJob) {
    const index = inProgressPublishingJobs.findIndex(function(inProgressPublishingJob) {
        return inProgressPublishingJob.videoId === completedPublishingJob.videoId && inProgressPublishingJob.format === completedPublishingJob.format && inProgressPublishingJob.resolution === completedPublishingJob.resolution;
    });

    return index;
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
                reject(publishingJob);
            }
            else {
                addToPublishVideoEncodingTracker(videoId);

                performEncodingJob(jwtToken, videoId, format, resolution, sourceFileExtension)
                .then((data) => {
                    performUploadingJob(jwtToken, videoId, format, resolution)
                    .then((data) => {
                        resolve(publishingJob);
                    })
                    .catch(error => {
                        reject(publishingJob);
                    });
                })
                .catch(error => {
                    reject(publishingJob);
                });
            }
        })
        .catch(error => {
            reject(publishingJob);
        });
    });
}

function performEncodingJob(jwtToken, videoId, format, resolution, sourceFileExtension) {
    return new Promise(function(resolve, reject) {
        if(!isPublishVideoEncodingStopping(videoId)) {
            const sourceFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/source/' + videoId + sourceFileExtension);
            
            const destinationFileExtension = '.' + format;
            let destinationFilePath = '';
            
            if(format === 'm3u8') {
                fs.mkdirSync(path.join(getTempVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/adaptive/m3u8/manifest-' + resolution + destinationFileExtension);
            }
            else if(format === 'mp4') {
                fs.mkdirSync(path.join(getTempVideosDirectoryPath(), videoId + '/progressive/mp4/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/progressive/mp4/' + resolution + '/' + resolution + destinationFileExtension);
            }
            else if(format === 'webm') {
                fs.mkdirSync(path.join(getTempVideosDirectoryPath(), videoId + '/progressive/webm/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/progressive/webm/' + resolution + '/' + resolution + destinationFileExtension);
            }
            else if(format === 'ogv') {
                fs.mkdirSync(path.join(getTempVideosDirectoryPath(), videoId + '/progressive/ogv/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/progressive/ogv/' + resolution + '/' + resolution + destinationFileExtension);
            }
            
            const ffmpegArguments = generateFfmpegVideoArguments(videoId, resolution, format, sourceFilePath, destinationFilePath);
            
            const process = spawn(getFfmpegPath(), ffmpegArguments);

            addProcessToPublishVideoEncodingTracker(videoId, process);
            
            process.stdout.on('data', function (data) {
                const output = Buffer.from(data).toString();
                logDebugMessageToConsole(output, null, null, true);
            });
            
            let lengthTimestamp = '00:00:00.00';
            let lengthSeconds = 0;
            let currentTimeSeconds = 0;
            
            let stderrOutput = '';
            process.stderr.on('data', function (data) {
                if(!isPublishVideoEncodingStopping(videoId)) {
                    const stderrTemp = Buffer.from(data).toString();
                    
                    logDebugMessageToConsole(stderrTemp, null, null, false);
                    
                    if(stderrTemp.indexOf('time=') != -1) {
                        logDebugMessageToConsole(stderrTemp, null, null, true);
                        
                        if(lengthSeconds === 0) {
                            let index = stderrOutput.indexOf('Duration: ');
                            lengthTimestamp = stderrOutput.substr(index + 10, 11);
                            lengthSeconds = timestampToSeconds(lengthTimestamp);
                        }
                        
                        let index = stderrTemp.indexOf('time=');
                        let currentTimestamp = stderrTemp.substr(index + 5, 11);
                        
                        currentTimeSeconds = timestampToSeconds(currentTimestamp);
                    }
                    else {
                        stderrOutput += stderrTemp;
                    }
                    
                    // no need to rate limit; interval is approximately 1 second
                    if(currentTimeSeconds > 0 && lengthSeconds > 0) {
                        const encodingProgress = Math.ceil(((currentTimeSeconds / lengthSeconds) * 100) / 2);
                        
                        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing', videoId: videoId, format: format, resolution: resolution, progress: encodingProgress }}});
                    }
                }
            });
            
            process.on('spawn', function (code) {
                logDebugMessageToConsole('performEncodingJob ffmpeg process spawned with arguments: ' + ffmpegArguments, null, null, true);
            });
            
            process.on('exit', function (code) {
                logDebugMessageToConsole('performEncodingJob ffmpeg process exited with exit code: ' + code, null, null, true);
                
                if(code === 0) {
                    resolve();
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
        if(!isPublishVideoEncodingStopping(videoId)) {
            const paths = [];
            
            if(format === 'm3u8') {
                const manifestFilePath = path.join(getTempVideosDirectoryPath(), videoId + '/adaptive/m3u8/manifest-' + resolution + '.m3u8');
                const segmentsDirectoryPath = path.join(getTempVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution);
                
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
                const filePath = path.join(getTempVideosDirectoryPath(), videoId + '/progressive/mp4/' + resolution + '/' + fileName);
                
                paths.push({fileName : fileName, filePath: filePath});
            }
            else if(format === 'webm') {
                const fileName = resolution + '.webm';
                const filePath = path.join(getTempVideosDirectoryPath(), videoId + '/progressive/webm/' + resolution + '/' + fileName);
                
                paths.push({fileName : fileName, filePath: filePath});
            }
            else if(format === 'ogv') {
                const fileName = resolution + '.ogv';
                const filePath = path.join(getTempVideosDirectoryPath(), videoId + '/progressive/ogv/' + resolution + '/' + fileName);
                
                paths.push({fileName : fileName, filePath: filePath});
            }
            
            node_uploadVideo(jwtToken, videoId, format, resolution, paths)
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    reject({isError: true, message: nodeResponseData.message});
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

function finishVideoPublish(jwtToken, videoId, sourceFileExtension) {
    deleteDirectoryRecursive(path.join(getTempVideosDirectoryPath(), videoId + '/adaptive'));
    deleteDirectoryRecursive(path.join(getTempVideosDirectoryPath(), videoId + '/progressive'));
    
    const sourceFilePath =  path.join(getTempVideosDirectoryPath(), videoId + '/source/' + videoId + sourceFileExtension);
    
    if(fs.existsSync(sourceFilePath)) {
        const result = spawnSync(getFfmpegPath(), [
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
                        
                        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'published', videoId: videoId, lengthTimestamp: lengthTimestamp, lengthSeconds: lengthSeconds }}});
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

function generateFfmpegVideoArguments(videoId, resolution, format, sourceFilePath, destinationFilePath) {
    let width;
    let height;

    const clientSettings = getClientSettings();
    
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

    let bitrate;

    if(format === 'm3u8') {
        bitrate = clientSettings.videoEncoderSettings.hls[resolution + '-bitrate'] + 'k';
    }
    else if(format === 'mp4') {
        bitrate = clientSettings.videoEncoderSettings.mp4[resolution + '-bitrate'] + 'k';
    }
    else if(format === 'webm') {
        bitrate = clientSettings.videoEncoderSettings.webm[resolution + '-bitrate'] + 'k';
    }
    else if(format === 'ogv') {
        bitrate = clientSettings.videoEncoderSettings.ogv[resolution + '-bitrate'] + 'k';
    }

    let scale;
    
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
    
    let ffmpegArguments = [];
    
    if(clientSettings.processingAgent.processingAgentType === 'cpu') {
        if(format === 'm3u8') {
            ffmpegArguments = [
                '-i', sourceFilePath,
                '-c:a', 'aac',
                '-c:v', 'libx264', '-b:v', bitrate,
                '-sc_threshold', '0',
                '-vf', filterComplex,
                '-f', 'hls', 
                '-hls_time', '6', '-hls_init_time', '2',
                '-hls_segment_filename', hlsSegmentOutputPath, 
                '-hls_base_url', `/assets/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                '-hls_playlist_type', 'vod',
                destinationFilePath
            ];
        }
        else if(format === 'mp4') {
            ffmpegArguments = [
                '-i', sourceFilePath,
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
                    '-c:a', 'aac',
                    '-c:v', 'h264_nvenc', '-b:v', bitrate,
                    '-sc_threshold', '0',
                    '-g', '180',
                    '-vf', filterComplex,
                    '-f', 'hls',
                    '-hls_time', '6', '-hls_init_time', '2',
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `/assets/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'vod',
                    destinationFilePath
                ];
            }
            else if(format === 'mp4') {
                ffmpegArguments = [
                    '-hwaccel', 'cuvid',
                    '-hwaccel_output_format', 'cuda',
                    '-i', sourceFilePath,
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
                    '-c:a', 'aac',
                    '-c:v', 'h264_amf', '-b:v', bitrate,
                    '-sc_threshold', '0',
                    '-g', '180',
                    '-vf', filterComplex,
                    '-f', 'hls',
                    '-hls_time', '6', '-hls_init_time', '2',
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `/assets/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'vod',
                    destinationFilePath
                ];
            }
            else if(format === 'mp4') {
                ffmpegArguments = [
                    '-hwaccel', 'dxva2',
                    '-hwaccel_device', '0',
                    '-i', sourceFilePath,
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
    startVideoPublishInterval
};