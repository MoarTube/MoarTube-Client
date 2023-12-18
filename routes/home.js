const express = require('express');

const { logDebugMessageToConsole, getMoarTubeNodeHttpProtocol, getMoarTubeNodeIp, getMoarTubeNodePort, getNetworkAddresses } = require('../utils/helpers');
const { node_isAuthenticated, node_getSettings } = require('../utils/node-communications');


const router = express.Router();


router.get('/', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send('error communicating with the MoarTube node');
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getSettings(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send('error communicating with the MoarTube node');
                    }
                    else {
                        const nodeSettings = nodeResponseData.nodeSettings;
                        
                        if(nodeSettings.isNodeConfigured) {
                            res.redirect('/videos');
                        }
                        else {
                            res.redirect('/configure');
                        }
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send('error communicating with the MoarTube node');
                });
            }
            else {
                res.redirect('/account/signin');
            }
        }
    });
});

router.get('/node', (req, res) => {
    const nodeInformation = {
        publicNodeProtocol: getMoarTubeNodeHttpProtocol(),
        publicNodeAddress: getMoarTubeNodeIp(),
        publicNodePort: getMoarTubeNodePort()
    };
    
    res.send({isError: false, nodeInformation: nodeInformation});
});

app.get('/network', (req, res) => {
    const networkAddresses = getNetworkAddresses();
    
    res.send({isError: false, networkAddresses: networkAddresses});
});

app.get('/heartbeat', (req, res) => {
    res.end();
});

module.exports = router;