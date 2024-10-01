const path = require('path');
const fs = require('fs');

const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');
const { node_isAuthenticated, node_doSignout, node_getSettings, node_getVideoComments, node_removeComment, node_searchComments } = require('../utils/node-communications');

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
                        const pagePath = path.join(getPublicDirectoryPath(), 'pages/comments.html');
                        const fileStream = fs.createReadStream(pagePath);
                        res.setHeader('Content-Type', 'text/html');
                        fileStream.pipe(res);
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

function videoId_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    const videoId = req.params.videoId;
    const timestamp = Date.now();
    const type = 'before';
    const sort = 'descending';

    node_getVideoComments(jwtToken, videoId, timestamp, type, sort)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send(nodeResponseData.message);
        }
        else {
            const comments = nodeResponseData.comments;
            
            res.send({isError: false, comments: comments});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send('error communicating with the MoarTube node');
    });
}

function delete_POST(req, res) {
    const jwtToken = req.session.jwtToken;

    const videoId = req.body.videoId;
    const commentId = req.body.commentId;
    const timestamp = req.body.timestamp;
    
    node_removeComment(jwtToken, videoId, commentId, timestamp)
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

function search_GET(req, res) {
    const jwtToken = req.session.jwtToken;

    const videoId = req.query.videoId;
    const searchTerm = req.query.searchTerm;
    const limit = req.query.limit;
    const timestamp = req.query.timestamp;
    
    node_searchComments(jwtToken, videoId, searchTerm, limit, timestamp)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            res.send({isError: false, comments: nodeResponseData.comments});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

module.exports = {
    root_GET,
    videoId_GET,
    delete_POST,
    search_GET
}