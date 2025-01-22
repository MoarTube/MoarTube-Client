const {
    websocketClientBroadcast, getNodeSettings, checkNetworkPortStatus
} = require('../utils/helpers');
const {
    isPortValid
} = require('../utils/validators');
const {
    node_stopVideoStreaming, node_streamVideo, node_setSourceFileExtension, node_getVideoData, node_setVideoChatSettings
} = require('../utils/node-communications');
const {
    s3_deleteObjectsWithPrefix, s3_convertM3u8DynamicManifestsToStatic
} = require('../utils/s3-communications');
const {
    addLiveStreamToLiveStreamTracker
} = require('../utils/trackers/live-stream-tracker');
const {
    performStreamingJob
} = require('../utils/handlers/live-stream-handler');

async function start_POST(jwtToken, title, description, tags, rtmpPort, resolution, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, videoId) {
    let result;

    if (!isPortValid(rtmpPort)) {
        result = { isError: true, message: 'rtmpPort is not valid' };
    }
    else {
        const portStatus = await checkNetworkPortStatus(rtmpPort, '127.0.0.1');

        if (portStatus === 'closed') {
            const uuid = 'moartube';

            const response1 = await node_streamVideo(jwtToken, title, description, tags, rtmpPort, uuid, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, resolution, videoId);

            if (!response1.isError) {
                const videoId = response1.videoId;

                addLiveStreamToLiveStreamTracker(videoId);

                const response2 = await node_setSourceFileExtension(jwtToken, videoId, '.ts');

                if (!response2.isError) {
                    const rtmpUrl = 'rtmp://' + networkAddress + ':' + rtmpPort + '/live/' + uuid;

                    await performStreamingJob(jwtToken, videoId, rtmpUrl, 'm3u8', resolution, isRecordingStreamRemotely, isRecordingStreamLocally);

                    result = { isError: false, rtmpUrl: rtmpUrl };
                }
                else {
                    result = response2;
                }
            }
            else {
                result = response1;
            }
        }
        else {
            result = { isError: true, message: 'port ' + rtmpPort + ' is not available' };
        }
    }

    return result;
}

async function videoIdStop_POST(jwtToken, videoId) {
    websocketClientBroadcast({ eventName: 'echo', jwtToken: jwtToken, data: { eventName: 'video_status', payload: { type: 'streaming_stopping', videoId: videoId } } });

    const nodeSettings = await getNodeSettings(jwtToken);
    const storageConfig = nodeSettings.storageConfig;

    if (storageConfig.storageMode === 's3provider') {
        const s3Config = storageConfig.s3Config;

        const videoData = (await node_getVideoData(videoId)).videoData;
        const isStreamRecordedRemotely = videoData.isStreamRecordedRemotely;

        if (isStreamRecordedRemotely) {
            const resolutions = videoData.outputs.m3u8;

            await s3_convertM3u8DynamicManifestsToStatic(s3Config, videoId, resolutions);
        }
        else {
            const prefix = 'external/videos/' + videoId + '/adaptive/m3u8';

            await s3_deleteObjectsWithPrefix(s3Config, prefix);
        }
    }

    const response = await node_stopVideoStreaming(jwtToken, videoId);

    if (!response.isError) {
        websocketClientBroadcast({ eventName: 'echo', jwtToken: jwtToken, data: { eventName: 'video_status', payload: { type: 'streaming_stopped', videoId: videoId } } });
    }

    return response;
}

async function videoIdRtmpInformation_GET(videoId) {
    let result;

    let response = await node_getVideoData(videoId);

    if (!response.isError) {
        const meta = response.videoData.meta;

        const netorkAddress = meta.networkAddress;
        const rtmpPort = meta.rtmpPort;
        const uuid = meta.uuid;

        const rtmpStreamUrl = 'rtmp://' + netorkAddress + ':' + rtmpPort + '/live/' + uuid;
        const rtmpServerUrl = 'rtmp://' + netorkAddress + ':' + rtmpPort + '/live';
        const rtmpStreamkey = uuid;

        result = { isError: false, rtmpStreamUrl: rtmpStreamUrl, rtmpServerUrl: rtmpServerUrl, rtmpStreamkey: rtmpStreamkey };
    }
    else {
        result = response;
    }

    return result;
}

async function videoIdChatSettings_GET(videoId) {
    let result;

    let response = await node_getVideoData(videoId);

    if (!response.isError) {
        const meta = response.videoData.meta;

        const isChatHistoryEnabled = meta.chatSettings.isChatHistoryEnabled;
        const chatHistoryLimit = meta.chatSettings.chatHistoryLimit;

        result = { isError: false, isChatHistoryEnabled: isChatHistoryEnabled, chatHistoryLimit: chatHistoryLimit };
    }
    else {
        result = response;
    }

    return result;
}

async function videoIdChatSettings_POST(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit) {
    const response = await node_setVideoChatSettings(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit);

    return response;
}

module.exports = {
    start_POST,
    videoIdStop_POST,
    videoIdRtmpInformation_GET,
    videoIdChatSettings_GET,
    videoIdChatSettings_POST
};