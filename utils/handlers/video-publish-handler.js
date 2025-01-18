const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;

const { 
    logDebugMessageToConsole, deleteDirectoryRecursive, timestampToSeconds, websocketClientBroadcast, getVideosDirectoryPath, getFfmpegPath, getClientSettings,
    refreshM3u8MasterManifest, getNodeSettings
 } = require('../helpers');
const { node_setVideoPublishing, node_setVideoPublished, node_uploadVideo, node_getExternalVideosBaseUrl, node_setVideoFormatResolutionPublished
 } = require('../node-communications');
 const { s3_putObjectsFromFilePathsWithProgress
 } = require('../s3-communications');
const { getPendingPublishVideoTracker, getPendingPublishVideoTrackerQueueSize, enqueuePendingPublishVideo, dequeuePendingPublishVideo } = require('../trackers/pending-publish-video-tracker');
const { addToPublishVideoEncodingTracker, isPublishVideoEncodingStopping } = require('../trackers/publish-video-encoding-tracker');

let inProgressPublishingJobCount = 0;
let maximumInProgressPublishingJobCount = 5;

const inProgressPublishingJobs = [];

function startVideoPublishInterval() {
    setInterval(function() {
        while(getPendingPublishVideoTrackerQueueSize() > 0 && inProgressPublishingJobCount < maximumInProgressPublishingJobCount) {
            inProgressPublishingJobCount++;
            
            inProgressPublishingJobs.push(dequeuePendingPublishVideo());
            
            startPublishingJob(inProgressPublishingJobs[inProgressPublishingJobs.length - 1])
            .then(async (completedPublishingJob) => {
                try {
                    await finishVideoFormatResolutionPublished(completedPublishingJob.jwtToken, completedPublishingJob.videoId, completedPublishingJob.format, completedPublishingJob.resolution);

                    const index = findInProgressPublishJobIndex(completedPublishingJob);
                    
                    inProgressPublishingJobs.splice(index, 1);

                    const videoIdHasPendingPublishingJobExists = getPendingPublishVideoTracker().some((pendingPublishingJob) => pendingPublishingJob.hasOwnProperty('videoId') && pendingPublishingJob.videoId === completedPublishingJob.videoId);
                    const videoIdHasInProgressPublishingJobExists = inProgressPublishingJobs.some((inProgressPublishingJob) => inProgressPublishingJob.hasOwnProperty('videoId') && inProgressPublishingJob.videoId === completedPublishingJob.videoId);
                    
                    if(completedPublishingJob.format === 'm3u8') {
                        await refreshM3u8MasterManifest(completedPublishingJob.jwtToken, completedPublishingJob.videoId);
                    }

                    if(!videoIdHasPendingPublishingJobExists && !videoIdHasInProgressPublishingJobExists) {
                        await finishVideoPublish(completedPublishingJob.jwtToken, completedPublishingJob.videoId, completedPublishingJob.format);

                        logDebugMessageToConsole('completed publishing job for video: ' + completedPublishingJob.videoId, null, null);
                    }
                    
                    inProgressPublishingJobCount--;

                    /*
                    If resource constraints was encountered, it was likely transient.
                    Reset the maximum concurrent jobs allowed when no jobs remain.
                    */
                    if(inProgressPublishingJobCount === 0 && getPendingPublishVideoTrackerQueueSize() === 0) {
                        maximumInProgressPublishingJobCount = 5;
                    }
                }
                catch(error) {
                    logDebugMessageToConsole(null, error, null);
                }
            })
            .catch(failedPublishingJob => {
                /*
                Failure is likely due to resource constraints leading to ffmpeg process termination by the operating system.
                The assumption is likely correct, so we'll assume it 100% of the time to no ill effect.
                Lower the maximum concurrent jobs allowed and append the job to the end of the queue.
                The publish attempt will continue until the job is either successful or the user intervenes.
                */

                logDebugMessageToConsole('failed publishing job: ' + failedPublishingJob, null, null);

                if (!(failedPublishingJob instanceof Error)) {
                    const index = findInProgressPublishJobIndex(failedPublishingJob);

                    inProgressPublishingJobs.splice(index, 1);

                    const videoId = failedPublishingJob.videoId;
                    
                    if(!isPublishVideoEncodingStopping(videoId)) {
                        const jwtToken = failedPublishingJob.jwtToken;
                        const format = failedPublishingJob.format;
                        const resolution = failedPublishingJob.resolution;

                        failedPublishingJob.idleInterval = setInterval(function() {
                            websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing', videoId: videoId, format: format, resolution: resolution, progress: 0 }}});
                        }, 1000);

                        enqueuePendingPublishVideo(failedPublishingJob);

                        if(maximumInProgressPublishingJobCount > 1) {
                            maximumInProgressPublishingJobCount--;
                        }
                    }

                    inProgressPublishingJobCount--;
                }
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
        .then(async nodeResponseData => {
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
                        logDebugMessageToConsole(null, error, new Error().stack);
                        
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
    return new Promise(async function(resolve, reject) {
        if(!isPublishVideoEncodingStopping(videoId)) {
            const sourceFilePath = path.join(getVideosDirectoryPath(), videoId + '/source/' + videoId + sourceFileExtension);
            
            const destinationFileExtension = '.' + format;
            let destinationFilePath = '';
            
            if(format === 'm3u8') {
                fs.mkdirSync(path.join(getVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution), { recursive: true });
                
                destinationFilePath = path.join(getVideosDirectoryPath(), videoId + '/adaptive/m3u8/manifest-' + resolution + destinationFileExtension);
            }
            else if(format === 'mp4') {
                fs.mkdirSync(path.join(getVideosDirectoryPath(), videoId + '/progressive/mp4'), { recursive: true });
                
                destinationFilePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/mp4/' + resolution + destinationFileExtension);
            }
            else if(format === 'webm') {
                fs.mkdirSync(path.join(getVideosDirectoryPath(), videoId + '/progressive/webm'), { recursive: true });
                
                destinationFilePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/webm/' + resolution + destinationFileExtension);
            }
            else if(format === 'ogv') {
                fs.mkdirSync(path.join(getVideosDirectoryPath(), videoId + '/progressive/ogv'), { recursive: true });
                
                destinationFilePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/ogv/' + resolution + destinationFileExtension);
            }

            const externalVideosBaseUrl = (await node_getExternalVideosBaseUrl(jwtToken)).externalVideosBaseUrl;
            
            const ffmpegArguments = generateFfmpegVideoArguments(videoId, resolution, format, sourceFilePath, destinationFilePath, sourceFileExtension, externalVideosBaseUrl);
            
            const process = spawn(getFfmpegPath(), ffmpegArguments);
            
            process.stdout.on('data', function (data) {
                const output = Buffer.from(data).toString();
                logDebugMessageToConsole(output, null, null);
            });
            
            let lengthTimestamp = '00:00:00.00';
            let lengthSeconds = 0;
            let currentTimeSeconds = 0;
            
            let stderrOutput = '';
            process.stderr.on('data', function (data) {
                if(!isPublishVideoEncodingStopping(videoId)) {
                    const stderrTemp = Buffer.from(data).toString();
                    
                    logDebugMessageToConsole(stderrTemp, null, null);
                    
                    if(stderrTemp.indexOf('time=') != -1) {
                        logDebugMessageToConsole(stderrTemp, null, null);
                        
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
                else {
                    process.kill();
                }
            });
            
            process.on('spawn', function (code) {
                logDebugMessageToConsole('performEncodingJob ffmpeg process spawned with arguments: ' + ffmpegArguments, null, null);
            });
            
            process.on('exit', function (code) {
                logDebugMessageToConsole('performEncodingJob ffmpeg process exited with exit code: ' + code, null, null);
                
                if(code === 0) {
                    resolve();
                }
                else {
                    reject({isError: true, message: 'encoding process ended with an error code: ' + code});
                }
            });
            
            process.on('error', function (code) {
                logDebugMessageToConsole('performEncodingJob errorred with error code: ' + code, null, null);
            });
        }
        else {
            reject({isError: true, message: videoId + ' attempted to encode but publishing is stopping'});
        }
    });
}

function performUploadingJob(jwtToken, videoId, format, resolution) {
    return new Promise(async function(resolve, reject) {			
        if(!isPublishVideoEncodingStopping(videoId)) {
            const nodeSettings = await getNodeSettings(jwtToken);

            if(nodeSettings.storageConfig.storageMode === 'filesystem') {
                const paths = [];
    
                if(format === 'm3u8') {
                    const manifestFilePath = path.join(getVideosDirectoryPath(), videoId + '/adaptive/m3u8/manifest-' + resolution + '.m3u8');
                    const segmentsDirectoryPath = path.join(getVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution);
                    
                    paths.push({fileName : 'manifest-' + resolution + '.m3u8', filePath: manifestFilePath, contentType: 'application/vnd.apple.mpegurl'});
                    
                    fs.readdirSync(segmentsDirectoryPath).forEach(fileName => {
                        const segmentFilePath = segmentsDirectoryPath + '/' + fileName;
                        if (!fs.statSync(segmentFilePath).isDirectory()) {
                            paths.push({fileName: fileName, filePath: segmentFilePath, contentType: 'video/mp2t'});
                        }
                    });
                }
                else if(format === 'mp4') {
                    const fileName = resolution + '.mp4';
                    const filePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/mp4/' + fileName);
                    
                    paths.push({fileName: fileName, filePath: filePath, contentType: 'video/mp4'});
                }
                else if(format === 'webm') {
                    const fileName = resolution + '.webm';
                    const filePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/webm/' + fileName);
                    
                    paths.push({fileName: fileName, filePath: filePath, contentType: 'video/webm'});
                }
                else if(format === 'ogv') {
                    const fileName = resolution + '.ogv';
                    const filePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/ogv/' + fileName);
                    
                    paths.push({fileName: fileName, filePath: filePath, contentType: 'video/ogg'});
                }
                
                node_uploadVideo(jwtToken, videoId, format, resolution, paths)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        
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
                    reject(error);
                });
            }
            else if(nodeSettings.storageConfig.storageMode === 's3provider') {
                const s3Config = nodeSettings.storageConfig.s3Config;

                const paths = [];
    
                if(format === 'm3u8') {
                    const manifestFilePath = path.join(getVideosDirectoryPath(), videoId + '/adaptive/m3u8/manifest-' + resolution + '.m3u8');
                    const segmentsDirectoryPath = path.join(getVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution);
                    const manifestKey = 'external/videos/' + videoId + '/adaptive/m3u8/static/manifests/manifest-' + resolution + '.m3u8';

                    paths.push({key: manifestKey, filePath: manifestFilePath, contentType: 'application/vnd.apple.mpegurl'});
                    
                    fs.readdirSync(segmentsDirectoryPath).forEach(fileName => {
                        const segmentFilePath = segmentsDirectoryPath + '/' + fileName;
                        if (!fs.statSync(segmentFilePath).isDirectory()) {
                            const segmentKey = 'external/videos/' + videoId + '/adaptive/m3u8/' + resolution + '/segments/' + fileName;
                            paths.push({key: segmentKey, filePath: segmentFilePath, contentType: 'video/mp2t'});
                        }
                    });
                }
                else if(format === 'mp4') {
                    const key = 'external/videos/' + videoId + '/progressive/mp4/' + resolution + '.mp4';
                    const filePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/mp4/' + resolution + '.mp4');
                    
                    paths.push({key: key, filePath: filePath, contentType: 'video/mp4'});
                }
                else if(format === 'webm') {
                    const key = 'external/videos/' + videoId + '/progressive/webm/' + resolution + '.webm';
                    const filePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/webm/' + resolution + '.webm');
                    
                    paths.push({key: key, filePath: filePath, contentType: 'video/webm'});
                }
                else if(format === 'ogv') {
                    const key = 'external/videos/' + videoId + '/progressive/ogv/' + resolution + '.ogv';
                    const filePath = path.join(getVideosDirectoryPath(), videoId + '/progressive/ogv/' + resolution + '.ogv');
                    
                    paths.push({key: key, filePath: filePath, contentType: 'video/ogg'});
                }

                s3_putObjectsFromFilePathsWithProgress(s3Config, jwtToken, paths, videoId, format, resolution)
                .then(responses => {
                    resolve({isError: false});
                })
                .catch(error => {
                    reject(error);
                });
            }
        }
        else {
            reject({isError: true, message: videoId + ' attempted to upload but publishing is stopping'});
        }
    });
}

async function finishVideoPublish(jwtToken, videoId, format) {
    await deleteDirectoryRecursive(path.join(getVideosDirectoryPath(), videoId + '/adaptive'));
    await deleteDirectoryRecursive(path.join(getVideosDirectoryPath(), videoId + '/progressive'));

    await node_setVideoPublished(jwtToken, videoId);

    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'published', videoId: videoId }}});
}

function finishVideoFormatResolutionPublished(jwtToken, videoId, format, resolution) {
    return new Promise(async function(resolve, reject) {
        try {
            await node_setVideoFormatResolutionPublished(jwtToken, videoId, format, resolution);

            logDebugMessageToConsole('video finished publishing for id: ' + videoId + ' format: ' + format + ' resolution: ' + resolution, null, null);

            resolve();
        }
        catch(error) {
            reject(error);
        }
    });
}

function generateFfmpegVideoArguments(videoId, resolution, format, sourceFilePath, destinationFilePath, sourceFileExtension, externalVideosBaseUrl) {
    let width;
    let height;
    let bitrate;
    let gop;
    let framerate;
    let segmentLength;
    
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

    if(format === 'm3u8') {
        bitrate = clientSettings.videoEncoderSettings.hls[resolution + '-bitrate'] + 'k';
        gop = clientSettings.videoEncoderSettings.hls.gop;
        framerate = clientSettings.videoEncoderSettings.hls.framerate;
        segmentLength = clientSettings.videoEncoderSettings.hls.segmentLength;
    }
    else if(format === 'mp4') {
        bitrate = clientSettings.videoEncoderSettings.mp4[resolution + '-bitrate'] + 'k';
        gop = clientSettings.videoEncoderSettings.mp4.gop;
        framerate = clientSettings.videoEncoderSettings.mp4.framerate;
    }
    else if(format === 'webm') {
        bitrate = clientSettings.videoEncoderSettings.webm[resolution + '-bitrate'] + 'k';
        gop = clientSettings.videoEncoderSettings.webm.gop;
        framerate = clientSettings.videoEncoderSettings.webm.framerate;
    }
    else if(format === 'ogv') {
        bitrate = clientSettings.videoEncoderSettings.ogv[resolution + '-bitrate'] + 'k';
        gop = clientSettings.videoEncoderSettings.ogv.gop;
        framerate = clientSettings.videoEncoderSettings.ogv.framerate;
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

    const hlsSegmentOutputPath = path.join(getVideosDirectoryPath(), videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts');
    
    let ffmpegArguments = [];

    if(clientSettings.processingAgent.processingAgentType === 'cpu') {
        if(format === 'm3u8') {
            ffmpegArguments = [
                '-i', sourceFilePath,
                '-c:a', 'aac',
                '-c:v', 'libx264', '-b:v', bitrate,
                '-sc_threshold', '0',
                '-vf', filterComplex,
                '-g', gop,
                '-r', framerate,
                '-f', 'hls', 
                '-hls_time', segmentLength,
                '-hls_segment_filename', hlsSegmentOutputPath, 
                '-hls_base_url', `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
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
                '-g', gop,
                '-r', framerate,
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
                '-g', gop,
                '-r', framerate,
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
                '-g', gop,
                '-r', framerate,
                '-y',
                destinationFilePath
            ];
        }
    }
    else if(clientSettings.processingAgent.processingAgentType === 'gpu') {
        if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
            if(format === 'm3u8') {
                let decoderParam1;
                let decoderParam2;

                if(sourceFileExtension === '.ts') {
                    decoderParam1 = '-c:v';
                    decoderParam2 = 'h264_cuvid';
                }
                else {
                    decoderParam1 = '-hwaccel_output_format';
                    decoderParam2 = 'cuda';
                }

                ffmpegArguments = [
                    '-hwaccel', 'cuvid',
                    decoderParam1, decoderParam2,
                    '-i', sourceFilePath,
                    '-c:a', 'aac',
                    '-c:v', 'h264_nvenc', '-b:v', bitrate,
                    '-sc_threshold', '0',
                    '-g', gop,
                    '-r', framerate,
                    '-vf', filterComplex,
                    '-f', 'hls',
                    '-hls_time', segmentLength,
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'vod',
                    destinationFilePath
                ];
            }
            else if(format === 'mp4') {
                let decoderParam1;
                let decoderParam2;

                if(sourceFileExtension === '.ts') {
                    decoderParam1 = '-c:v';
                    decoderParam2 = 'h264_cuvid';
                }
                else {
                    decoderParam1 = '-hwaccel_output_format';
                    decoderParam2 = 'cuda';
                }

                ffmpegArguments = [
                    '-hwaccel', 'cuvid',
                    decoderParam1, decoderParam2,
                    '-i', sourceFilePath,
                    '-c:a', 'aac',
                    '-c:v', 'h264_nvenc', '-b:v', bitrate,
                    '-vf', filterComplex,
                    '-g', gop,
                    '-r', framerate,
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
                    '-g', gop,
                    '-r', framerate,
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
                    '-g', gop,
                    '-r', framerate,
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
                    '-g', gop,
                    '-r', framerate,
                    '-vf', filterComplex,
                    '-f', 'hls',
                    '-hls_time', segmentLength,
                    '-hls_segment_filename', hlsSegmentOutputPath,
                    '-hls_base_url', `${externalVideosBaseUrl}/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
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
                    '-g', gop,
                    '-r', framerate,
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
                    '-g', gop,
                    '-r', framerate,
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
                    '-g', gop,
                    '-r', framerate,
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