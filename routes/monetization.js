const express = require('express');
const path = require('path');
const fs = require('fs');

const { monetizationAll_GET, monetizationAdd_POST, monetizationDelete_POST } = require('../controllers/monetization');
const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');
const { node_isAuthenticated, node_doSignout } = require('../utils/node-communications');

const router = express.Router();

router.get('/', async (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);

            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/monetization.html');
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
        logDebugMessageToConsole(null, error, new Error().stack);
        
        node_doSignout(req, res);
    });
});

router.get('/all', async (req, res) => {
    try {
        const data = await monetizationAll_GET();

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/add', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const walletAddress = req.body.walletAddress;
        const chain = req.body.chain;
        const currency = req.body.currency;

        const data = await monetizationAdd_POST(jwtToken, walletAddress, chain, currency);

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
        
        const cryptoWalletAddressId = req.body.cryptoWalletAddressId;

        const data = await monetizationDelete_POST(jwtToken, cryptoWalletAddressId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

module.exports = router;