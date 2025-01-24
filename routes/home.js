const express = require('express');

const { 
    network_GET 
} = require('../controllers/home');
const { 
    node_isAuthenticated 
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
            res.send(response.message);
        }
        else if (response.isAuthenticated) {
            res.redirect('/videos');
        }
        else {
            res.redirect('/account/signin');
        }
    }
    catch (error) {
        logDebugMessageToConsole('Error during authentication', error, new Error().stack);

        res.status(500).send('An error occurred while processing your request.');
    }
});

router.get('/network', (req, res) => {
    try {
        const data = network_GET();

        res.send(data);
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({ isError: true, message: 'error communicating with the MoarTube node' });
    }
});

module.exports = router;