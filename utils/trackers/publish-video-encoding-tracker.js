const { 
    websocketServerBroadcast
} = require('../helpers');

const PUBLISH_VIDEO_ENCODING_TRACKER = {};

function getPublishVideoEncodingTracker() {
    return PUBLISH_VIDEO_ENCODING_TRACKER;
}

function addToPublishVideoEncodingTracker(videoId) {
    PUBLISH_VIDEO_ENCODING_TRACKER[videoId] = {processes: [], stopping: false};
}

function isPublishVideoEncodingStopping(videoId) {
    if(PublishVideoEncodingExists(videoId)) {
        return PUBLISH_VIDEO_ENCODING_TRACKER[videoId].stopping;
    }
}

function addProcessToPublishVideoEncodingTracker(videoId, process) {
    if(PublishVideoEncodingExists(videoId)) {
        PUBLISH_VIDEO_ENCODING_TRACKER[videoId].processes.push(process);
    }
}

function stoppingPublishVideoEncoding(videoId) {
    if(PublishVideoEncodingExists(videoId)) {
        PUBLISH_VIDEO_ENCODING_TRACKER[videoId].stopping = true;
    }
}

function stoppedPublishVideoEncoding(videoId, data) {
    if(PublishVideoEncodingExists(videoId)) {
        const processes = PUBLISH_VIDEO_ENCODING_TRACKER[videoId].processes;

        processes.forEach(function(process) {
            process.kill(); // no point in being graceful about it; just kill it
        });
            
        //delete PUBLISH_VIDEO_ENCODING_TRACKER[videoId];
        
        websocketServerBroadcast(data);
    }
}

function PublishVideoEncodingExists(videoId) {
    return PUBLISH_VIDEO_ENCODING_TRACKER.hasOwnProperty(videoId);
}

module.exports = {
    getPublishVideoEncodingTracker,
    addToPublishVideoEncodingTracker,
    isPublishVideoEncodingStopping,
    addProcessToPublishVideoEncodingTracker,
    stoppingPublishVideoEncoding,
    stoppedPublishVideoEncoding
};