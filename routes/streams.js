const express = require('express');

const { start_POST, videoIdStop_POST, videoIdRtmpInformation_GET, videoIdChatSettings_GET, videoIdChatSettings_POST } = require('../controllers/streams');
const { logDebugMessageToConsole } = require('../utils/helpers');

const router = express.Router();

router.post('/start', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const title = req.body.title;
        const description = req.body.description;
        const tags = req.body.tags;
        const rtmpPort = req.body.rtmpPort;
        const resolution = req.body.resolution;
        const isRecordingStreamRemotely = req.body.isRecordingStreamRemotely;
        const isRecordingStreamLocally = req.body.isRecordingStreamLocally;
        const networkAddress = req.body.networkAddress;
        const videoId = req.body.videoId;

        const data = await start_POST(jwtToken, title, description, tags, rtmpPort, resolution, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, videoId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/:videoId/stop', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const videoId = req.params.videoId;

        const data = await videoIdStop_POST(jwtToken, videoId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.get('/:videoId/rtmp/information', async (req, res) => {
    try {
        const videoId = req.params.videoId;

        const data = await videoIdRtmpInformation_GET(videoId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.get('/:videoId/chat/settings', async (req, res) => {
    try {
        const videoId = req.params.videoId;

        const data = await videoIdChatSettings_GET(videoId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/:videoId/chat/settings', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;
        const isChatHistoryEnabled = req.body.isChatHistoryEnabled;
        const chatHistoryLimit = req.body.chatHistoryLimit;

        const data = await videoIdChatSettings_POST(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

module.exports = router;