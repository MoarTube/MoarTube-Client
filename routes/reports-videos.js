const express = require('express');
const path = require('path');
const fs = require('fs');

const { all_GET, archiveAll_GET, archive_POST, delete_POST, archiveDelete_POST } = require('../controllers/reports-videos');
const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');
const { node_isAuthenticated, node_doSignout } = require('../utils/node-communications');

const router = express.Router();

router.get('/', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/reports-videos.html');
                const fileStream = fs.createReadStream(pagePath);
                res.setHeader('Content-Type', 'text/html');
                fileStream.pipe(res);
            }
            else {
                res.redirect('/account/signin');
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        node_doSignout(req, res);
    });
});

router.get('/all', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await all_GET(jwtToken);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack, true);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.get('/archive/all', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await archiveAll_GET(jwtToken);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack, true);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/archive', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const reportId = req.body.reportId;

        const data = await archive_POST(jwtToken, reportId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack, true);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/delete', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const reportId = req.body.reportId;

        const data = await delete_POST(jwtToken, reportId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack, true);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/archive/delete', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const archiveId = req.body.archiveId;

        const data = await archiveDelete_POST(jwtToken, archiveId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack, true);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

module.exports = router;