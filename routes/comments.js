const express = require('express');

const { videoId_GET, delete_POST, search_GET } = require('../controllers/comments');
const { node_isAuthenticated, node_doSignout } = require('../utils/node-communications');
const { logDebugMessageToConsole } = require('../utils/helpers');

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

            res.render('comments', {
                nodeSettings: nodeSettings,
                newContentCounts: newContentCounts,
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

        const videoId = req.query.videoId;
        const searchTerm = req.query.searchTerm;
        const limit = req.query.limit;
        const timestamp = req.query.timestamp;

        const data = await search_GET(jwtToken, videoId, searchTerm, limit, timestamp);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.get('/:videoId', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const videoId = req.params.videoId;
        const timestamp = Date.now();
        const type = 'before';
        const sort = 'descending';

        const data = await videoId_GET(jwtToken, videoId, timestamp, type, sort);

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

        const videoId = req.body.videoId;
        const commentId = req.body.commentId;
        const timestamp = req.body.timestamp;

        const data = await delete_POST(jwtToken, videoId, commentId, timestamp);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

module.exports = router;