const {
    websocketServerBroadcast
} = require('../helpers');

const PUBLISH_VIDEO_ENCODING_TRACKER = {};

function getPublishVideoEncodingTracker() {
    return PUBLISH_VIDEO_ENCODING_TRACKER;
}

function addToPublishVideoEncodingTracker(videoId) {
    PUBLISH_VIDEO_ENCODING_TRACKER[videoId] = { stopping: false };
}

function isPublishVideoEncodingStopping(videoId) {
    if (PublishVideoEncodingExists(videoId)) {
        return PUBLISH_VIDEO_ENCODING_TRACKER[videoId].stopping;
    }
}

function stoppingPublishVideoEncoding(videoId) {
    if (PublishVideoEncodingExists(videoId)) {
        PUBLISH_VIDEO_ENCODING_TRACKER[videoId].stopping = true;
    }
}

function stoppedPublishVideoEncoding(videoId, data) {
    if (PublishVideoEncodingExists(videoId)) {
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
    stoppingPublishVideoEncoding,
    stoppedPublishVideoEncoding
};