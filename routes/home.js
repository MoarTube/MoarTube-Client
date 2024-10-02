const express = require('express');

const {  network_GET } = require('../controllers/home');
const { node_isAuthenticated } = require('../utils/node-communications');
const { logDebugMessageToConsole } = require('../utils/helpers');

const router = express.Router();

router.get('/', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
            
            res.send(nodeResponseData.message);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                res.redirect('/videos');
            }
            else {
                res.redirect('/account/signin');
            }
        }
    });
});

router.get('/network', (req, res) => {
    try {
        const data = network_GET();

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

module.exports = router;