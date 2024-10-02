const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_doVideosSearchAll, node_getNewContentCounts, node_setContentChecked } = require('../utils/node-communications');

function search_GET(searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    return new Promise(function(resolve, reject) {
        node_doVideosSearchAll(searchTerm, sortTerm, tagTerm, tagLimit, timestamp)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, searchResults: nodeResponseData.searchResults});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function newContentCounts_GET(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_getNewContentCounts(jwtToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, newContentCounts: nodeResponseData.newContentCounts});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function contentChecked_POST(jwtToken, contentType) {
    return new Promise(function(resolve, reject) {
        node_setContentChecked(jwtToken, contentType)
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
    search_GET,
    newContentCounts_GET,
    contentChecked_POST
}