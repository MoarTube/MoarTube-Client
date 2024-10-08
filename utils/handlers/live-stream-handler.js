const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const sharp = require('sharp');

const { logDebugMessageToConsole, getVideosDirectoryPath, websocketClientBroadcast, getFfmpegPath, getClientSettings, timestampToSeconds, deleteDirectoryRecursive } = require('../helpers');
const { node_setVideoLengths, node_setThumbnail, node_setPreview, node_setPoster, node_uploadStream, node_getVideoBandwidth, node_removeAdaptiveStreamSegment, node_stopVideoStreaming } = require('../node-communications');
const { addProcessToLiveStreamTracker, isLiveStreamStopping, liveStreamExists } = require('../trackers/live-stream-tracker');

function performStreamingJob(jwtToken, videoId, rtmpUrl, format, resolution, isRecordingStreamRemotely, isRecordingStreamLocally) {
    return new Promise(async function(resolve, reject) {
        logDebugMessageToConsole('starting live stream for id: ' + videoId, null, null);

        await deleteDirectoryRecursive(path.join(getVideosDirectoryPath(), videoId));
        
        fs.mkdirSync(path.join(getVideosDirectoryPath(), videoId + '/source'), { recursive: true });
        fs.mkdirSync(path.join(getVideosDirectoryPath(), videoId + '/images'), { recursive: true });
        fs.mkdirSync(path.join(getVideosDirectoryPath(), videoId + '/adaptive'), { recursive: true });
        fs.mkdirSync(path.join(getVideosDirectoryPath(), videoId + '/progressive'), { recursive: true });
        
        const sourceDirectoryPath = path.join(getVideosDirectoryPath(), videoId + '/source');
        const sourceFilePath = path.join(sourceDirectoryPath, '/' + videoId + '.ts');
        const manifestFileName = 'manifest-' + resolution + '.m3u8';
        
        const ffmpegArguments = generateFfmpegLiveArguments(videoId, resolution, format, rtmpUrl, isRecordingStreamRemotely);
        
        let process = spawn(getFfmpegPath(), ffmpegArguments);

        addProcessToLiveStreamTracker(videoId, process);
        
        let lengthSeconds = 0;
        let lengthTimestamp = '';

        process.stderr.on('data', function (data) {
            if(!isLiveStreamStopping(videoId)) {
                const stderrTemp = Buffer.from(data).toString();
                logDebugMessageToConsole(stderrTemp, null, null);
                
                if(stderrTemp.indexOf('time=') != -1) {
                    let index = stderrTemp.indexOf('time=');
                    lengthTimestamp = stderrTemp.substr(index + 5, 11);
                    lengthSeconds = timestampToSeconds(lengthTimestamp);
                    
                    node_setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp)
                    .then(nodeResponseData => {
                        if(nodeResponseData.isError) {
                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        }
                        else {
                            // do nothing
                        }
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack);
                    });
                }
            }
        });

        let accumulatedBuffer = Buffer.alloc(0);
        const segmentRegex = /(.*\/)(.*\.ts)$/;
        let nextExpectedSegmentIndex = 0;
        let endOfValidManifestPattern = Buffer.from(`segment-${resolution}-${nextExpectedSegmentIndex}.ts\n`);
        let endOfValidManifestPatternLength = endOfValidManifestPattern.length;

        process.stdout.on('data', (data) => {
            accumulatedBuffer = Buffer.concat([accumulatedBuffer, data]);

            /*
            The end of an HLS manifest is indicated by a newline character.
            Preceding that newline character is the most recent expected segment entry.
            By looking for the pattern ".ts\n" at the end of the latest data packet, we can detect the end of the manifest.
            This detection will also indicate the accumulation of the video data for the most recent expected segment entry.
            This is because ffmpeg outputs the segment data first, followed by the manifest data.
            Using the #EXTM3U entry of the manifest reveals the partitioning location between the most recent expected segment data and the manifest data.

            Note:
            1) Since stdout is a data stream, the last data packet for the most recent expected segment may contain both video data and manifest data.
            2) A data packet may end with the pattern ".ts\n" but instead be a false positive for detecting the end of the manifest if the data packet 
            happened to be mid-manifest with that pattern. Validation is performed to guard against this rare edge case.
            */

            // end of manifest detection
            if (data[data.length - 4] === 0x2E && // .
                data[data.length - 3] === 0x74 && // t
                data[data.length - 2] === 0x73 && // s
                data[data.length - 1] === 0x0A) { // \n
                const manifestIndex = accumulatedBuffer.indexOf('#EXTM3U');
                const startingSegmentIndex = accumulatedBuffer.indexOf('#EXT-X-MEDIA-SEQUENCE');

                if(manifestIndex !== -1 && startingSegmentIndex !== -1) {
                    let manifestBuffer = accumulatedBuffer.slice(manifestIndex);
                    const segmentBuffer = accumulatedBuffer.slice(0, manifestIndex);

                    const manifestLines = manifestBuffer.toString().split('\n');

                    let segmentCounter = -1;
                    for(const manifestLine of manifestLines) {
                        if(manifestLine.includes('#EXT-X-MEDIA-SEQUENCE')) {
                            segmentCounter = parseInt(manifestLine.split(':')[1], 10);

                            break;
                        }
                    }

                    if(segmentCounter >= 0) {
                        /*
                        hls_segment_filename cannot be used to configure segment naming when piping ffmpeg to stdout.
                        Setting hls_segment_filename activates file system storage instead for some stupid reason.
                        Manifest file must therefore be post-processed to configure segment naming.
                        We can't generate an entire manifest because we can't anticipate ffmpeg's calculation of segment length (#EXTINF).
                        */
                        let updatedManifestLines = manifestLines.map(line => {
                            if (segmentRegex.test(line.trim())) {
                                const match = line.trim().match(segmentRegex);
                                const segmentPath = match[1];
                                const newSegmentName = `segment-${resolution}-${segmentCounter}.ts`;
                                const newSegmentPath = `${segmentPath}${newSegmentName}`;

                                segmentCounter++;

                                return newSegmentPath;
                            }

                            return line;
                        });

                        manifestBuffer = Buffer.from(updatedManifestLines.join('\n'));

                        const endOfValidManifestPatternIndex = manifestBuffer.indexOf(endOfValidManifestPattern);

                        // validate end of manifest detection by detecting for the expected segment in its expected position
                        if(endOfValidManifestPatternIndex !== -1 && ((manifestBuffer.length - endOfValidManifestPatternLength) === endOfValidManifestPatternIndex)) {
                            accumulatedBuffer = Buffer.alloc(0);

                            nextExpectedSegmentIndex = segmentCounter;
                            endOfValidManifestPattern = Buffer.from(`segment-${resolution}-${nextExpectedSegmentIndex}.ts\n`);
                            endOfValidManifestPatternLength = endOfValidManifestPattern.length;

                            segmentCounter--;

                            const segmentFileName = 'segment-' + resolution + '-' + segmentCounter + '.ts';

                            sendSegmentToNode(jwtToken, videoId, resolution, manifestBuffer, segmentBuffer, manifestFileName, segmentFileName);
                            sendImagesToNode(jwtToken, videoId, segmentBuffer);

                            if(isRecordingStreamLocally) {
                                fs.writeFileSync(sourceFilePath, segmentBuffer, { flag: 'a' });
                            }

                            if(!isRecordingStreamRemotely) {
                                const segmentIndexToRemove = segmentCounter - 20;
                                
                                if(segmentIndexToRemove >= 0) {
                                    const segmentName = 'segment-' + resolution + '-' + segmentIndexToRemove + '.ts';
                                    
                                    node_removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName)
                                    .then(nodeResponseData => {
                                        if(nodeResponseData.isError) {
                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                                        }
                                        else {
                                            logDebugMessageToConsole('node removed segment ' + segmentName, null, null);
                                        }
                                    })
                                    .catch(error => {
                                        logDebugMessageToConsole(null, error, new Error().stack);
                                    });
                                }
                            }

                            node_getVideoBandwidth(jwtToken, videoId)
                            .then(nodeResponseData => {
                                if(nodeResponseData.isError) {
                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                                }
                                else {
                                    const bandwidth = nodeResponseData.bandwidth;
                                    
                                    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: {type: 'streaming', videoId: videoId, lengthTimestamp: lengthTimestamp, bandwidth: bandwidth}}});
                                }
                            })
                            .catch(error => {
                                logDebugMessageToConsole(null, error, new Error().stack);
                            });
                        }
                    }
                }
            }
        });

        process.on('spawn', function (code) {
            logDebugMessageToConsole('performStreamingJob ffmpeg process spawned with arguments: ' + ffmpegArguments, null, null);
        });
        
        process.on('exit', function (code) {
            logDebugMessageToConsole('performStreamingJob live stream process exited with exit code: ' + code, null, null);
            
            if(liveStreamExists(videoId)) {
                logDebugMessageToConsole('performStreamingJob checking if live stream process was interrupted by MoarTube Client...', null, null);
                
                if(!isLiveStreamStopping(videoId)) {
                    logDebugMessageToConsole('performStreamingJob determined live stream process was not interrupted by MoarTube Client', null, null);
                    
                    websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopping', videoId: videoId }}});
                    
                    node_stopVideoStreaming(jwtToken, videoId)
                    .then((nodeResponseData) => {
                        if(nodeResponseData.isError) {
                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        }
                        else {
                            websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopped', videoId: videoId }}});
                        }
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack);
                    });
                }
                else {
                    logDebugMessageToConsole('performStreamingJob determined live stream process was interrupted by MoarTube Client', null, null);
                }
            }
        });
        
        process.on('error', function (code) {
            logDebugMessageToConsole('performEncodingJob errored with error code: ' + code, null, null);
        });
        
        resolve({isError: false});
    });
}

function sendSegmentToNode(jwtToken, videoId, resolution, manifestBuffer, segmentBuffer, manifestFileName, segmentFileName) {
    logDebugMessageToConsole('sending segment ' + segmentFileName + ' to node for video Id ' + videoId, null, null);

    node_uploadStream(jwtToken, videoId, 'm3u8', resolution, manifestBuffer, segmentBuffer, manifestFileName, segmentFileName)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
        }
        else {
            // do nothing
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack);
    })
    .finally(() => {
        
    });
}

let uploadingThumbnail = false;
let uploadingPreview = false;
let uploadingPoster = false;
let lastVideoImagesUpdateTimestamp = 0;
function sendImagesToNode(jwtToken, videoId, segmentBuffer) {
    // Update thumbnail, preview, and poster every 10 seconds.
    if(!uploadingThumbnail && !uploadingPreview && !uploadingPoster && (Date.now() - lastVideoImagesUpdateTimestamp > 10000)) {
        lastVideoImagesUpdateTimestamp = Date.now();

        const imagesDirectoryPath = path.join(getVideosDirectoryPath(), videoId + '/images');
        const sourceImagePath = path.join(imagesDirectoryPath, 'source.jpg');
        
        let process = spawn(getFfmpegPath(), [
            '-i', 'pipe:0',
            '-ss', '0.5',
            '-q', '18',
            '-frames:v', '1', 
            '-y',
            sourceImagePath
        ]);

        /*
        ffmpeg utilizes trailer information to detect the end (end of file, EOF) of piped input to stdin.
        This will trigger an uncaught exception (Error: write EOF) due to live mpeg-ts segments not having a trailer, thus no EOF indication.
        This is benign, also reportedly does not occur on Unix-based systems, though unconfirmed.
        */
        process.stdin.write(segmentBuffer, (error) => {
            if (error) {
                //console.error('Error writing to stdin:', error);
            }

            process.stdin.end();
        });

        process.on('error', function (code) {
            logDebugMessageToConsole('live source image generating errorred with error code: ' + code, null, null);
        });
        
        process.on('spawn', function (code) {
            logDebugMessageToConsole('live source image generating ffmpeg process spawned', null, null);
        });
        
        process.on('exit', function (code) {
            logDebugMessageToConsole('live source image generating ffmpeg process exited with exit code: ' + code, null, null);

            if(code === 0) {
                if(fs.existsSync(sourceImagePath)) {
                    logDebugMessageToConsole('generated live source image for video: ' + videoId, null, null);

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
                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                            }
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack);
                        })
                        .finally(() => {
                            uploadingThumbnail = false;
                        });
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack);

                        uploadingThumbnail = false;
                    });

                    sharp(sourceImagePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toFile(previewImagePath)
                    .then(() => {
                        node_setPreview(jwtToken, videoId, previewImagePath)
                        .then(nodeResponseData => {
                            if(nodeResponseData.isError) {
                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                            }
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack);
                        })
                        .finally(() => {
                            uploadingPreview = false;
                        });
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack);

                        uploadingPreview = false;
                    });

                    sharp(sourceImagePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toFile(posterImagePath)
                    .then(() => {
                        node_setPoster(jwtToken, videoId, posterImagePath)
                        .then(nodeResponseData => {
                            if(nodeResponseData.isError) {
                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                            }
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack);
                        })
                        .finally(() => {
                            uploadingPoster = false;
                        });
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack);

                        uploadingPoster = false;
                    });
                } else {
                    logDebugMessageToConsole('expected a live source image to be generated in <' + sourceImagePath + '> but found none', null, null);
                }
            }
            else {
                logDebugMessageToConsole('live source image generating exited with code: ' + code, null, null);
            }
        });
    }
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
                '-g', gop,
                '-r', framerate,
                '-c:a', 'aac',
                '-f', 'hls', 
                '-hls_time', segmentLength, '-hls_list_size', '20',
                '-hls_base_url', `/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                '-hls_playlist_type', 'event', 
                'pipe:1'
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
                    '-hls_base_url', `/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'event', 
                    'pipe:1'
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
                    '-hls_base_url', `/external/videos/${videoId}/adaptive/m3u8/${resolution}/segments/`,
                    '-hls_playlist_type', 'event', 
                    'pipe:1'
                ];
            }
        }
    }
    
    /*
    hls_list_size will automatically be be 0 (no size limit) if hls_playlist_type is configured for event, thus recording remotely.
    hls_playlist_type is removed if not recording remotely so that hls_list_size can take precedence.
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