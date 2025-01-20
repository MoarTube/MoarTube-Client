const express = require('express');
const path = require('path');
const fs = require('fs');

const { all_GET, archiveAll_GET, archive_POST, delete_POST, archiveDelete_POST } = require('../controllers/reports-comments');
const { node_isAuthenticated, node_doSignout } = require('../utils/node-communications');
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
                res.render('reports-comments', {

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

router.get('/all', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await all_GET(jwtToken);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

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
        logDebugMessageToConsole(null, error, new Error().stack);

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
        logDebugMessageToConsole(null, error, new Error().stack);

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
        logDebugMessageToConsole(null, error, new Error().stack);

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
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

module.exports = router;