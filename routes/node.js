const express = require('express');

const { 
    search_GET, newContentCounts_GET, contentChecked_POST 
} = require('../controllers/node');
const { 
    logDebugMessageToConsole 
} = require('../utils/helpers');

const router = express.Router();

router.get('/search', async (req, res) => {
    try {
        const searchTerm = req.query.searchTerm;
        const sortTerm = req.query.sortTerm;
        const tagTerm = req.query.tagTerm;
        const tagLimit = req.query.tagLimit;
        const timestamp = req.query.timestamp;

        const data = await search_GET(searchTerm, sortTerm, tagTerm, tagLimit, timestamp);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.get('/newContentCounts', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await newContentCounts_GET(jwtToken);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

router.post('/contentChecked', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const contentType = req.body.contentType;

        const data = await contentChecked_POST(jwtToken, contentType);

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

module.exports = router;