const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_MonetizationAll, node_MonetizationAdd, node_MonetizationDelete } = require('../utils/node-communications');

function monetizationAll_GET() {
    return new Promise(function(resolve, reject) {
        node_MonetizationAll()
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const cryptoWalletAddresses = nodeResponseData.cryptoWalletAddresses;

                resolve({isError: false, cryptoWalletAddresses: cryptoWalletAddresses});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function monetizationAdd_POST(jwtToken, walletAddress, chain, currency) {
    return new Promise(function(resolve, reject) {
        node_MonetizationAdd(jwtToken, walletAddress, chain, currency)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const cryptoWalletAddress = nodeResponseData.cryptoWalletAddress;

                resolve({isError: false, cryptoWalletAddress: cryptoWalletAddress});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function monetizationDelete_POST(jwtToken, cryptoWalletAddressId) {
    return new Promise(function(resolve, reject) {
        node_MonetizationDelete(jwtToken, cryptoWalletAddressId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

module.exports = {
    monetizationAll_GET,
    monetizationAdd_POST,
    monetizationDelete_POST
}