const portscanner = require('portscanner');

const { logDebugMessageToConsole, websocketClientBroadcast } = require('../utils/helpers');
const { isPortValid } = require('../utils/validators');
const { node_stopVideoStreaming, node_streamVideo, node_setSourceFileExtension, node_getVideoData, node_setVideoChatSettings, node_getStreamMeta } = require('../utils/node-communications');
const { addLiveStreamToLiveStreamTracker } = require('../utils/trackers/live-stream-tracker');
const { performStreamingJob } = require('../utils/handlers/live-stream-handler');

function start_POST(jwtToken, title, description, tags, rtmpPort, resolution, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, videoId) {
    return new Promise(function(resolve, reject) {
        if(!isPortValid(rtmpPort)) {
            resolve({isError: true, message: 'rtmpPort is not valid'});
        }
        else {
            portscanner.checkPortStatus(rtmpPort, '127.0.0.1', function(error, portStatus) {
                if (error) {
                    resolve({isError: true, message: 'an error occurred while checking the availability of port ' + rtmpPort});
                }
                else {
                    if (portStatus === 'closed') {
                        const uuid = 'moartube';
                        
                        node_streamVideo(jwtToken, title, description, tags, rtmpPort, uuid, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, resolution, videoId)
                        .then(nodeResponseData => {
                            if(nodeResponseData.isError) {
                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                
                                resolve({isError: true, message: nodeResponseData.message});
                            }
                            else {
                                const videoId = nodeResponseData.videoId;

                                addLiveStreamToLiveStreamTracker(videoId);
                                
                                node_setSourceFileExtension(jwtToken, videoId, '.ts')
                                .then(nodeResponseData => {
                                    if(nodeResponseData.isError) {
                                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                        
                                        resolve({isError: true, message: nodeResponseData.message});
                                    }
                                    else {
                                        const rtmpUrl = 'rtmp://' + networkAddress + ':' + rtmpPort + '/live/' + uuid;
                                        
                                        performStreamingJob(jwtToken, videoId, title, description, tags, rtmpUrl, 'm3u8', resolution, isRecordingStreamRemotely, isRecordingStreamLocally);
                                        
                                        resolve({isError: false, rtmpUrl: rtmpUrl});
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
                    } else {
                        resolve({isError: true, message: 'port ' + rtmpPort + ' is not available'});
                    }
                }
            });
        }
    });
}

function videoIdStop_POST(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopping', videoId: videoId }}});
        
        node_stopVideoStreaming(jwtToken, videoId)
        .then((nodeResponseData) => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                websocketClientBroadcast({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopped', videoId: videoId }}});
                
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdRtmpInformation_GET(videoId) {
    return new Promise(function(resolve, reject) {
        node_getVideoData(videoId)
        .then(nodeResponseData => {
            const meta = nodeResponseData.videoData.meta;

            const netorkAddress = meta.networkAddress;
            const rtmpPort = meta.rtmpPort;
            const uuid = meta.uuid;

            const rtmpStreamUrl = 'rtmp://' + netorkAddress + ':' + rtmpPort + '/live/' + uuid;
            const rtmpServerUrl = 'rtmp://' + netorkAddress + ':' + rtmpPort + '/live';
            const rtmpStreamkey = uuid;

            resolve({isError: false, rtmpStreamUrl: rtmpStreamUrl, rtmpServerUrl: rtmpServerUrl, rtmpStreamkey: rtmpStreamkey});
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdChatSettings_GET(videoId) {
    return new Promise(function(resolve, reject) {
        node_getVideoData(videoId)
        .then(nodeResponseData => {
            const meta = nodeResponseData.videoData.meta;
            
            const isChatHistoryEnabled = meta.chatSettings.isChatHistoryEnabled;
            const chatHistoryLimit = meta.chatSettings.chatHistoryLimit;
            
            resolve({isError: false, isChatHistoryEnabled: isChatHistoryEnabled, chatHistoryLimit: chatHistoryLimit});
        })
        .catch(error => {
            reject(error);
        });
    });
}

function videoIdChatSettings_POST(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit) {
    return new Promise(function(resolve, reject) {
        node_setVideoChatSettings(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit)
        .then(nodeResponseData => {
            resolve(nodeResponseData);
        })
        .catch(error => {
            reject(error);
        });
    });
}

module.exports = {
    start_POST,
    videoIdStop_POST,
    videoIdRtmpInformation_GET,
    videoIdChatSettings_GET,
    videoIdChatSettings_POST
};