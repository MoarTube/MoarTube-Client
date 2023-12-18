const path = require('path');
const fs = require('fs');

const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');
const { node_isAuthenticated, node_getSettings, node_doSignout } = require('../utils/node-communications');

function root_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getSettings(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        node_doSignout(req, res);
                    }
                    else {
                        const nodeSettings = nodeResponseData.nodeSettings;
                        
                        if(nodeSettings.isNodeConfigured) {
                            res.redirect('/settings');
                        }
                        else {
                            const pagePath = path.join(getPublicDirectoryPath(), 'pages/configure.html');
                            const fileStream = fs.createReadStream(pagePath);
                            res.setHeader('Content-Type', 'text/html');
                            fileStream.pipe(res);
                        }
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    node_doSignout(req, res);
                });
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
}

module.exports = {
    root_GET
}