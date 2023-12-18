const { 
    websocketServerBroadcast
} = require('../helpers');

const LIVE_STREAM_TRACKER = {};

function getLiveStreamTracker() {
    return LIVE_STREAM_TRACKER;
}

function addLiveStreamToLiveStreamTracker(videoId) {
    LIVE_STREAM_TRACKER[videoId] = {process: null, stopping: false};
}

function addProcessToLiveStreamTracker(videoId, process) {
    if(liveStreamExists(videoId)) {
        LIVE_STREAM_TRACKER[videoId].process = process;
    }
}

function isLiveStreamStopping(videoId) {
    if(liveStreamExists(videoId)) {
        return LIVE_STREAM_TRACKER[videoId].stopping;
    }
    else {
        return false;
    }
}

function stoppingLiveStream(videoId) {
    if(liveStreamExists(videoId)) {
        LIVE_STREAM_TRACKER[videoId].stopping = true;
    }
}

function stoppedLiveStream(videoId, data) {
    if(liveStreamExists(videoId)) {
        const process = LIVE_STREAM_TRACKER[videoId].process;

        process.kill(); // no point in being graceful about it; just kill it
            
        //delete LIVE_STREAM_TRACKER[videoId];
        
        websocketServerBroadcast(data);
    }
}

function liveStreamExists(videoId) {
    return LIVE_STREAM_TRACKER.hasOwnProperty(videoId);
}

module.exports = {
    getLiveStreamTracker,
    addLiveStreamToLiveStreamTracker,
    addProcessToLiveStreamTracker,
    isLiveStreamStopping,
    stoppingLiveStream,
    stoppedLiveStream,
    liveStreamExists
};