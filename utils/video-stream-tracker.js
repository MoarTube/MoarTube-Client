const VIDEO_STREAM_TRACKER = {};

function getVideoStreamTracker() {
    return VIDEO_STREAM_TRACKER;
}

function addVideoStreamVideoTracker(videoId, req) {
    VIDEO_STREAM_TRACKER[videoId] = {req: req, stopping: false};
}

function isVideoStreamStopping(videoId) {
    if(videoStreamExists(videoId)) {
        return VIDEO_STREAM_TRACKER[videoId].stopping;
    }
}

function stoppingVideoStream(videoId) {
    if(videoStreamExists(videoId)) {
        VIDEO_STREAM_TRACKER[videoId].stopping = true;
    }
}

function stoppedVideoStream(videoId) {
    if(videoStreamExists(videoId)) {
        const process = VIDEO_STREAM_TRACKER[videoId].process;

        process.kill(); // no point in being graceful about it; just kill it
            
        //delete VIDEO_STREAM_TRACKER[videoId];
        
        websocketServerBroadcast(parsedMessage.data);
    }
}

function videoStreamExists(videoId) {
    return VIDEO_STREAM_TRACKER.hasOwnProperty(videoId);
}

module.exports = {
    getVideoStreamTracker,
    addVideoStreamVideoTracker,
    isVideoStreamStopping,
    stoppingVideoStream,
    stoppedVideoStream,
    videoStreamExists
};