const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_doVideosSearchAll, node_getNewContentCounts, node_setContentChecked } = require('../utils/node-communications');

function search_GET(req, res) {
    const searchTerm = req.query.searchTerm;
    const sortTerm = req.query.sortTerm;
    const tagTerm = req.query.tagTerm;
    const tagLimit = req.query.tagLimit;
    const timestamp = req.query.timestamp;
    
    node_doVideosSearchAll(searchTerm, sortTerm, tagTerm, tagLimit, timestamp)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            res.send({isError: false, searchResults: nodeResponseData.searchResults});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function newContentCounts_GET(req, res) {
    const jwtToken = req.session.jwtToken;

    node_getNewContentCounts(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            res.send({isError: false, newContentCounts: nodeResponseData.newContentCounts});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function contentChecked_POST(req, res) {
    const jwtToken = req.session.jwtToken;

    const contentType = req.body.contentType;

    node_setContentChecked(jwtToken, contentType)
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

module.exports = {
    search_GET,
    newContentCounts_GET,
    contentChecked_POST
}