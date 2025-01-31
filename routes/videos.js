const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const {
    search_GET, import_POST, videoIdImportingStop_POST, videoIdPublishingStop_POST, videoIdPublish_POST, videoIdUnpublish_POST,
    tags_GET, tagsAll_GET, videoIdPublishes_GET, videoIdData_GET, videoIdData_POST, delete_POST, finalize_POST, videoIdIndexAdd_POST,
    videoIdIndexRemove_POST, videoIdThumbnail_POST, videoIdPreview_POST, videoIdPoster_POST, videoIdSources_GET,
    videoIdPermissions_GET, videoIdPermissions_POST
} = require('../controllers/videos');
const { 
    logDebugMessageToConsole, websocketClientBroadcast, getVideosDirectoryPath, getExternalVideosBaseUrl 
} = require('../utils/helpers');
const { 
    node_isAuthenticated, node_doSignout, node_importVideo, node_setVideoError 
} = require('../utils/node-communications');
const { 
    addVideoToImportVideoTracker, isVideoImportStopping 
} = require('../utils/trackers/import-video-tracker');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const response = await node_isAuthenticated(jwtToken);

        if (response.isError) {
            logDebugMessageToConsole(response.message, null, new Error().stack);

            node_doSignout(req, res);
        }
        else if (response.isAuthenticated) {
            const { node_GET } = require('../controllers/settings');
            const { newContentCounts_GET } = require('../controllers/node');

            const nodeSettings = await node_GET(jwtToken);
            const newContentCounts = (await newContentCounts_GET(jwtToken)).newContentCounts;
            const externalVideosBaseUrl = await getExternalVideosBaseUrl(jwtToken);

            res.render('videos', {
                nodeSettings: nodeSettings,
                newContentCounts: newContentCounts,
                externalVideosBaseUrl: externalVideosBaseUrl
            });
        }
        else {
            res.redirect('/account/signin');
        }
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        node_doSignout(req, res);
    }
});

router.get('/search', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const searchTerm = req.query.searchTerm;
        const sortTerm = req.query.sortTerm;
        const tagTerm = req.query.tagTerm;
        const tagLimit = req.query.tagLimit;
        const timestamp = req.query.timestamp;

        const data = await search_GET(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/import', (req, res) => {
    const jwtToken = req.session.jwtToken;

    logDebugMessageToConsole('attempting to import video file into the client file system', null, null);

    const totalFileSize = parseInt(req.headers['content-length']);

    if (totalFileSize > 0) {
        logDebugMessageToConsole('importing video into the client file system: ' + totalFileSize + ' bytes', null, null);

        const title = req.query.title;
        const description = req.query.description;
        const tags = req.query.tags;

        logDebugMessageToConsole('requesting video id for imported video....', null, null);

        node_importVideo(jwtToken, title, description, tags)
            .then(nodeResponseData => {
                if (nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);

                    res.send({ isError: true, message: nodeResponseData.message });
                }
                else {
                    const videoId = nodeResponseData.videoId;

                    logDebugMessageToConsole('imported video file assigned video id: ' + videoId, null, null);

                    addVideoToImportVideoTracker(videoId, req);

                    let lastImportingTime = 0;
                    let receivedFileSize = 0;

                    req.on('data', function (chunk) {
                        if (!isVideoImportStopping(videoId)) {
                            receivedFileSize += chunk.length;

                            const importProgress = Math.floor((receivedFileSize / totalFileSize) * 100);

                            const currentTime = Date.now();

                            if (currentTime - lastImportingTime >= 100) {
                                lastImportingTime = currentTime;

                                websocketClientBroadcast({ eventName: 'echo', jwtToken: jwtToken, data: { eventName: 'video_status', payload: { type: 'importing', videoId: videoId, progress: importProgress } } });
                            }
                        }
                    });

                    multer({
                        storage: multer.diskStorage({
                            destination: function (req, file, cb) {
                                const sourceDirectoryPath = path.join(getVideosDirectoryPath(), videoId + '/source');

                                fs.mkdirSync(sourceDirectoryPath, { recursive: true });

                                fs.access(sourceDirectoryPath, fs.constants.F_OK, function (error) {
                                    if (error) {
                                        cb(new Error('file upload error'), null);
                                    }
                                    else {
                                        cb(null, sourceDirectoryPath);
                                    }
                                });
                            },
                            filename: function (req, file, cb) {
                                let extension;

                                if (file.mimetype === 'video/mp4') {
                                    extension = '.mp4';
                                }
                                else if (file.mimetype === 'video/webm') {
                                    extension = '.webm';
                                }

                                const fileName = videoId + extension;

                                logDebugMessageToConsole('imported video file and assigned temporary file name: ' + fileName, null, null);

                                cb(null, fileName);
                            }
                        })
                    }).fields([{ name: 'video_file', maxCount: 1 }])
                        (req, res, async function (error) {
                            if (error) {
                                logDebugMessageToConsole(nodeResponseData.message, error, new Error().stack);

                                node_setVideoError(jwtToken, videoId)
                                    .then(nodeResponseData => {
                                        if (nodeResponseData.isError) {
                                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);

                                            res.send({ isError: true, message: nodeResponseData.message });
                                        }
                                        else {
                                            res.send({ isError: true, message: 'error communicating with the MoarTube node' });
                                        }
                                    })
                                    .catch(error => {
                                        logDebugMessageToConsole(null, error, new Error().stack);

                                        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
                                    });
                            }
                            else {
                                try {
                                    const videoFile = req.files['video_file'];

                                    const data = await import_POST(jwtToken, videoId, videoFile);

                                    res.send(data);
                                }
                                catch (error) {
                                    logDebugMessageToConsole(null, error, new Error().stack);

                                    res.send({ isError: true, message: 'error communicating with the MoarTube node' });
                                }
                            }
                        });
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack);

                res.send({ isError: true, message: 'error communicating with the MoarTube node' });
            });
    }
    else {
        logDebugMessageToConsole('expected totalFileSize of non-zero but got zero', null, null);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/importing/stop', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;

        const data = await videoIdImportingStop_POST(jwtToken, videoId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/publishing/stop', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;

        const data = await videoIdPublishingStop_POST(jwtToken, videoId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/publish', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;
        const publishings = req.body.publishings;

        const data = await videoIdPublish_POST(jwtToken, videoId, publishings);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/unpublish', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;
        const format = req.body.format;
        const resolution = req.body.resolution;

        const data = await videoIdUnpublish_POST(jwtToken, videoId, format, resolution);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.get('/tags', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await tags_GET(jwtToken);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.get('/tags/all', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await tagsAll_GET(jwtToken);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.get('/:videoId/publishes', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;

        const data = await videoIdPublishes_GET(jwtToken, videoId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.get('/:videoId/data', async (req, res) => {
    try {
        const videoId = req.params.videoId;

        const data = await videoIdData_GET(videoId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/data', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;
        const title = req.body.title;
        const description = req.body.description;
        const tags = req.body.tags;

        const data = await videoIdData_POST(jwtToken, videoId, title, description, tags);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/delete', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoIds = req.body.videoIds;

        const data = await delete_POST(jwtToken, videoIds);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/finalize', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoIds = req.body.videoIds;

        const data = await finalize_POST(jwtToken, videoIds);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/index/add', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;
        const containsAdultContent = req.body.containsAdultContent;
        const termsOfServiceAgreed = req.body.termsOfServiceAgreed;
        const cloudflareTurnstileToken = req.body.cloudflareTurnstileToken;

        const data = await videoIdIndexAdd_POST(jwtToken, videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/index/remove', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;
        const cloudflareTurnstileToken = req.body.cloudflareTurnstileToken;

        const data = await videoIdIndexRemove_POST(jwtToken, videoId, cloudflareTurnstileToken);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/images/thumbnail', (req, res) => {
    const jwtToken = req.session.jwtToken;

    const videoId = req.params.videoId;

    multer({
        storage: multer.memoryStorage(),
    }).fields([{ name: 'thumbnail_file', maxCount: 1 }])
        (req, res, async function (error) {
            if (error) {
                logDebugMessageToConsole(null, error, new Error().stack);

                res.send({ isError: true, message: 'error communicating with the MoarTube node' });
            }
            else {
                try {
                    const thumbnailFile = req.files['thumbnail_file'];

                    const data = await videoIdThumbnail_POST(jwtToken, videoId, thumbnailFile);

                    res.send(data);
                }
                catch (error) {
                    logDebugMessageToConsole(null, error, new Error().stack);

                    res.send({ isError: true, message: 'error communicating with the MoarTube node' });
                }
            }
        });
});

router.post('/:videoId/images/preview', (req, res) => {
    const jwtToken = req.session.jwtToken;

    const videoId = req.params.videoId;

    multer({
        storage: multer.memoryStorage(),
    }).fields([{ name: 'preview_file', maxCount: 1 }])
        (req, res, async function (error) {
            if (error) {
                logDebugMessageToConsole(null, error, new Error().stack);

                res.send({ isError: true, message: 'error communicating with the MoarTube node' });
            }
            else {
                try {
                    const previewFile = req.files['preview_file'];

                    const data = await videoIdPreview_POST(jwtToken, videoId, previewFile);

                    res.send(data);
                }
                catch (error) {
                    logDebugMessageToConsole(null, error, new Error().stack);

                    res.send({ isError: true, message: 'error communicating with the MoarTube node' });
                }
            }
        });
});

router.post('/:videoId/images/poster', (req, res) => {
    const jwtToken = req.session.jwtToken;

    const videoId = req.params.videoId;

    multer({
        storage: multer.memoryStorage(),
    }).fields([{ name: 'poster_file', maxCount: 1 }])
        (req, res, async function (error) {
            if (error) {
                logDebugMessageToConsole(null, error, new Error().stack);

                res.send({ isError: true, message: 'error communicating with the MoarTube node' });
            }
            else {
                try {
                    const posterFile = req.files['poster_file'];

                    const data = await videoIdPoster_POST(jwtToken, videoId, posterFile);

                    res.send(data);
                }
                catch (error) {
                    logDebugMessageToConsole(null, error, new Error().stack);

                    res.send({ isError: true, message: 'error communicating with the MoarTube node' });
                }
            }
        });
});

router.get('/:videoId/sources', async (req, res) => {
    try {
        const videoId = req.params.videoId;

        const data = await videoIdSources_GET(videoId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.get('/:videoId/permissions', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;

        const data = await videoIdPermissions_GET(jwtToken, videoId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/:videoId/permissions', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;
        const type = req.body.type;
        const isEnabled = req.body.isEnabled;

        const data = await videoIdPermissions_POST(jwtToken, videoId, type, isEnabled);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

module.exports = router;