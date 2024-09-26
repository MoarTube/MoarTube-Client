const path = require('path');
const fs = require('fs');

const { 
    logDebugMessageToConsole, getPublicDirectoryPath
} = require('../utils/helpers');
const { 
    node_isAuthenticated, node_doSignout, node_WalletAddressAll, node_WalletAddressAdd, node_WalletAddressDelete
} = require('../utils/node-communications');


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
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        node_doSignout(req, res);
    });
}

function walletAddressAll_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            node_WalletAddressAll()
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    res.send({isError: true, message: nodeResponseData.message});
                }
                else {
                    const cryptoWalletAddresses = nodeResponseData.cryptoWalletAddresses;

                    res.send({isError: false, cryptoWalletAddresses: cryptoWalletAddresses});
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function walletAddressAdd_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const walletAddress = req.body.walletAddress;
            const chain = req.body.chain;

            node_WalletAddressAdd(jwtToken, walletAddress, chain)
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    res.send({isError: true, message: nodeResponseData.message});
                }
                else {
                    const cryptoWalletAddress = nodeResponseData.cryptoWalletAddress;

                    res.send({isError: false, cryptoWalletAddress: cryptoWalletAddress});
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function walletAddressDelete_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const cryptoWalletAddressId = req.body.cryptoWalletAddressId;

            node_WalletAddressDelete(jwtToken, cryptoWalletAddressId)
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    res.send({isError: true, message: nodeResponseData.message});
                }
                else {
                    res.send({isError: false});
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

module.exports = {
    root_GET,
    walletAddressAll_GET,
    walletAddressAdd_POST,
    walletAddressDelete_POST
}