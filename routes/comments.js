const express = require('express');
const path = require('path');
const fs = require('fs');

const { root_GET, videoId_GET, delete_POST, search_GET } = require('../controllers/comments');
const { node_isAuthenticated, node_doSignout, node_getSettings } = require('../utils/node-communications');
const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');

const router = express.Router();

router.get('/', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
            
            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getSettings(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        
                        node_doSignout(req, res);
                    }
                    else {
                        const pagePath = path.join(getPublicDirectoryPath(), 'pages/comments.html');
                        const fileStream = fs.createReadStream(pagePath);
                        res.setHeader('Content-Type', 'text/html');
                        fileStream.pipe(res);
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack);
                    
                    node_doSignout(req, res);
                });
            }
            else {
                res.redirect('/account/signin');
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack);
        
        node_doSignout(req, res);
    });
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
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

module.exports = router;