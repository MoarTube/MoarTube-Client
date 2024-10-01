const express = require('express');
const path = require('path');
const fs = require('fs');

const { linksAll_GET, linksAdd_POST, linksDelete_POST } = require('../controllers/links');
const { node_isAuthenticated, node_doSignout } = require('../utils/node-communications');
const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');

const router = express.Router();

router.get('/', async (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/links.html');
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
        const data = await linksAll_GET();

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack, true);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/add', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const url = req.body.url;
        const svgGraphic = req.body.svgGraphic;

        const data = await linksAdd_POST(jwtToken, url, svgGraphic);

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
        
        const linkId = req.body.linkId;

        const data = await linksDelete_POST(jwtToken, linkId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

module.exports = router;