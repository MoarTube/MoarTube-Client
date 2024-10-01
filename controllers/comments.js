const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_getVideoComments, node_removeComment, node_searchComments } = require('../utils/node-communications');

function search_GET(jwtToken, videoId, searchTerm, limit, timestamp) {
    return new Promise(function(resolve, reject) {
        node_searchComments(jwtToken, videoId, searchTerm, limit, timestamp)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, comments: nodeResponseData.comments});
            }
        })
        .catch(error => {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            resolve({isError: true, message: 'error communicating with the MoarTube node'});
        });
    });
}

function videoId_GET(jwtToken, videoId, timestamp, type, sort) {
    return new Promise(function(resolve, reject) {
        node_getVideoComments(jwtToken, videoId, timestamp, type, sort)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve(nodeResponseData.message);
            }
            else {
                const comments = nodeResponseData.comments;
                
                resolve({isError: false, comments: comments});
            }
        })
        .catch(error => {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            resolve('error communicating with the MoarTube node');
        });
    });
}

function delete_POST(jwtToken, videoId, commentId, timestamp) {
    return new Promise(function(resolve, reject) {
        node_removeComment(jwtToken, videoId, commentId, timestamp)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            resolve({isError: true, message: 'error communicating with the MoarTube node'});
        });
    });
}

module.exports = {
    videoId_GET,
    delete_POST,
    search_GET
}