const express = require('express');

const { 
    linksAll_GET, linksAdd_POST, linksDelete_POST 
} = require('../controllers/links');
const { 
    node_isAuthenticated, node_doSignout 
} = require('../utils/node-communications');
const { 
    logDebugMessageToConsole 
} = require('../utils/helpers');

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
            const { linksAll_GET } = require('../controllers/links');

            const nodeSettings = await node_GET(jwtToken);
            const newContentCounts = (await newContentCounts_GET(jwtToken)).newContentCounts;
            const links = (await linksAll_GET()).links;

            res.render('links', {
                nodeSettings: nodeSettings,
                newContentCounts: newContentCounts,
                links: links,
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
        const data = await linksAll_GET();

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

        const url = req.body.url;
        const svgGraphic = req.body.svgGraphic;

        const data = await linksAdd_POST(jwtToken, url, svgGraphic);

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

        const linkId = req.body.linkId;

        const data = await linksDelete_POST(jwtToken, linkId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

module.exports = router;