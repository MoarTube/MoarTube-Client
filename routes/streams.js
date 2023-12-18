const express = require('express');

const { 
    start_POST, videoIdStop_POST, videoIdRtmpInformation_GET, videoIdChatSettings_GET, videoIdChatSettings_POST
 } = require('../controllers/streams');

const router = express.Router();

router.post('/start', (req, res) => {
    start_POST(req, res);
});

router.post('/:videoId/stop', (req, res) => {
    videoIdStop_POST(req, res);
});

router.get('/:videoId/rtmp/information', (req, res) => {
    videoIdRtmpInformation_GET(req, res);
});

router.get('/:videoId/chat/settings', (req, res) => {
    videoIdChatSettings_GET(req, res);
});

router.post('/:videoId/chat/settings', (req, res) => {
    videoIdChatSettings_POST(req, res);
});

module.exports = router;