const PENDING_PUBLISH_VIDEO_TRACKER = [];

function getPendingPublishVideoTracker() {
    return PENDING_PUBLISH_VIDEO_TRACKER;
}

function enqueuePendingPublishVideo(item) {
    PENDING_PUBLISH_VIDEO_TRACKER.push(item);
}

function dequeuePendingPublishVideo() {
    return PENDING_PUBLISH_VIDEO_TRACKER.shift();
}

function getPendingPublishVideoTrackerQueueSize() {
    return PENDING_PUBLISH_VIDEO_TRACKER.length;
}

function stopPendingPublishVideo(videoId) {
    PENDING_PUBLISH_VIDEO_TRACKER.forEach((pendingVideo, index) => {
        if (videoId === pendingVideo.videoId) {
            clearInterval(pendingVideo.idleInterval);

            PENDING_PUBLISH_VIDEO_TRACKER.splice(index, 1);
        }
    });
}

module.exports = {
    getPendingPublishVideoTracker,
    enqueuePendingPublishVideo,
    dequeuePendingPublishVideo,
    getPendingPublishVideoTrackerQueueSize,
    stopPendingPublishVideo
};