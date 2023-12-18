const express = require('express');

const { 
    root_GET, search_GET, import_POST, videoIdImportingStop_POST, videoIdPublishingStop_POST, videoIdPublish_POST, videoIdUnpublish_POST,
    tags_GET, tagsAll_GET, videoIdPublishes_GET, videoIdInformation_GET, videoIdInformation_POST, delete_POST, finalize_POST, videoIdIndexAdd_POST,
    videoIdIndexRemove_POST, videoIdAlias_POST, videoIdAlias_GET, videoIdThumbnail_GET, videoIdPreview_GET, videoIdPoster_GET, videoIdThumbnail_POST,
    videoIdPreview_POST, videoIdPoster_POST
} = require('../controllers/videos');

const router = express.Router();

router.get('/', (req, res) => {
    root_GET(req, res);
});

router.get('/search', (req, res) => {
    search_GET(req, res);
});

router.post('/import', (req, res) => {
    import_POST(req, res);
});

router.post('/:videoId/importing/stop', (req, res) => {
    videoIdImportingStop_POST(req, res);
});

router.post('/:videoId/publishing/stop', (req, res) => {
    videoIdPublishingStop_POST(req, res);
});

router.post('/:videoId/publish', (req, res) => {
    videoIdPublish_POST(req, res);
});

router.post('/:videoId/unpublish', (req, res) => {
    videoIdUnpublish_POST(req, res);
});

router.get('/tags', (req, res) => {
    tags_GET(req, res);
});

router.get('/tags/all', (req, res) => {
    tagsAll_GET(req, res);
});

router.get('/:videoId/publishes', (req, res) => {
    videoIdPublishes_GET(req, res);
});

router.get('/:videoId/information', (req, res) => {
    videoIdInformation_GET(req, res);
});

router.post('/:videoId/information', (req, res) => {
    videoIdInformation_POST(req, res);
});

router.post('/delete', (req, res) => {
    delete_POST(req, res);
});

router.post('/finalize', (req, res) => {
    finalize_POST(req, res);
});

router.post('/:videoId/index/add', (req, res) => {
    videoIdIndexAdd_POST(req, res);
});

router.post('/:videoId/index/remove', (req, res) => {
    videoIdIndexRemove_POST(req, res);
});

router.post('/:videoId/alias', (req, res) => {
    videoIdAlias_POST(req, res);
});

router.get('/:videoId/alias', (req, res) => {
    videoIdAlias_GET(req, res);
});

router.get('/:videoId/thumbnail', (req, res) => {
    videoIdThumbnail_GET(req, res);
});

router.get('/:videoId/preview', (req, res) => {
    videoIdPreview_GET(req, res);
});

router.get('/:videoId/poster', (req, res) => {
    videoIdPoster_GET(req, res);
});

router.post('/:videoId/thumbnail', (req, res) => {
    videoIdThumbnail_POST(req, res);
});

router.post('/:videoId/preview', (req, res) => {
    videoIdPreview_POST(req, res);
});

router.post('/:videoId/poster', (req, res) => {
    videoIdPoster_POST(req, res);
});

module.exports = router;