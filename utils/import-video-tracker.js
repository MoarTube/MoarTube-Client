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

function stoppedVideoImport(videoId) {
    if(videoImportExists(videoId)) {
        IMPORT_VIDEO_TRACKER[videoId].req.destroy();
            
        //delete importVideoTracker[videoId];
        
        websocketServerBroadcast(parsedMessage.data);
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