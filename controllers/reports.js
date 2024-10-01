const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_getReportCount } = require('../utils/node-communications');

function count_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_getReportCount(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const videoReportCount = nodeResponseData.videoReportCount;
            const commentReportCount = nodeResponseData.commentReportCount;
            const totalReportCount = nodeResponseData.totalReportCount;
            
            res.send({isError: false, videoReportCount: videoReportCount, commentReportCount: commentReportCount, totalReportCount: totalReportCount});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

module.exports = {
    count_GET
}