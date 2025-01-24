const express = require('express');

const { 
    monetizationAll_GET, monetizationAdd_POST, monetizationDelete_POST 
} = require('../controllers/monetization');
const { 
    logDebugMessageToConsole 
} = require('../utils/helpers');
const { 
    node_isAuthenticated, node_doSignout 
} = require('../utils/node-communications');

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
            const { monetizationAll_GET } = require('../controllers/monetization');

            const nodeSettings = await node_GET(jwtToken);
            const newContentCounts = (await newContentCounts_GET(jwtToken)).newContentCounts;
            const cryptoWalletAddresses = (await monetizationAll_GET()).cryptoWalletAddresses;

            res.render('monetization', {
                nodeSettings: nodeSettings,
                newContentCounts: newContentCounts,
                cryptoWalletAddresses: cryptoWalletAddresses,
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

router.get('/all', async (req, res) => {
    try {
        const data = await monetizationAll_GET();

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
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
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/delete', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const cryptoWalletAddressId = req.body.cryptoWalletAddressId;

        const data = await monetizationDelete_POST(jwtToken, cryptoWalletAddressId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

module.exports = router;