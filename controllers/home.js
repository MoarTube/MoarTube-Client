const path = require('path');
const fs = require('fs');

const { logDebugMessageToConsole, getMoarTubeNodeHttpProtocol, getMoarTubeNodeIp, getMoarTubeNodePort, getNetworkAddresses } = require('../utils/helpers');
const { node_isAuthenticated, node_getSettings } = require('../utils/node-communications');

function root_GET(req, res) {
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
}

function node_GET(req, res) {
    const nodeInformation = {
        publicNodeProtocol: getMoarTubeNodeHttpProtocol(),
        publicNodeAddress: getMoarTubeNodeIp(),
        publicNodePort: getMoarTubeNodePort()
    };
    
    res.send({isError: false, nodeInformation: nodeInformation});
}

function network_GET(req, res) {
    const networkAddresses = getNetworkAddresses();
    
    res.send({isError: false, networkAddresses: networkAddresses});
}

function heartbeat_GET(req, res) {
    res.end();
}

module.exports = {
    root_GET,
    node_GET,
    network_GET,
    heartbeat_GET
}