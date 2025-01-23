const express = require('express');

const { all_GET, archiveAll_GET, archive_POST, delete_POST, archiveDelete_POST } = require('../controllers/reports-videos');
const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_isAuthenticated, node_doSignout } = require('../utils/node-communications');

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
            const { all_GET, archiveAll_GET } = require('../controllers/reports-videos');

            const nodeSettings = await node_GET(jwtToken);
            const newContentCounts = (await newContentCounts_GET(jwtToken)).newContentCounts;
            const videoReports = (await all_GET(jwtToken)).reports;
            const videoReportsArchive = (await archiveAll_GET(jwtToken)).reports;

            res.render('reports-videos', {
                nodeSettings: nodeSettings,
                newContentCounts: newContentCounts,
                videoReports: videoReports,
                videoReportsArchive: videoReportsArchive,
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
        const jwtToken = req.session.jwtToken;

        const data = await all_GET(jwtToken);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.get('/archive/all', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await archiveAll_GET(jwtToken);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/archive', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const reportId = req.body.reportId;

        const data = await archive_POST(jwtToken, reportId);

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

        const reportId = req.body.reportId;

        const data = await delete_POST(jwtToken, reportId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/archive/delete', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const archiveId = req.body.archiveId;

        const data = await archiveDelete_POST(jwtToken, archiveId);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

module.exports = router;