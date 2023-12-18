const { 
    websocketServerBroadcast
} = require('../helpers');

const IMPORT_VIDEO_TRACKER = {};

function getImportVideoTracker() {
    return IMPORT_VIDEO_TRACKER;
}

function addVideoToImportVideoTracker(videoId, req) {
    IMPORT_VIDEO_TRACKER[videoId] = {req: req, stopping: false};
}

function isVideoImportStopping(videoId) {
    if(videoImportExists(videoId)) {
        return IMPORT_VIDEO_TRACKER[videoId].stopping;
    }
}

function stoppingVideoImport(videoId) {
    if(videoImportExists(videoId)) {
        IMPORT_VIDEO_TRACKER[videoId].stopping = true;
    }
}

function stoppedVideoImport(videoId, data) {
    if(videoImportExists(videoId)) {
        IMPORT_VIDEO_TRACKER[videoId].req.destroy();
            
        //delete IMPORT_VIDEO_TRACKER[videoId];
        
        websocketServerBroadcast(data);
    }
}

function videoImportExists(videoId) {
    return IMPORT_VIDEO_TRACKER.hasOwnProperty(videoId);
}

module.exports = {
    getImportVideoTracker,
    addVideoToImportVideoTracker,
    isVideoImportStopping,
    stoppingVideoImport,
    stoppedVideoImport,
    videoImportExists
};