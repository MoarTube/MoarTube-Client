const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_getCommentReports, node_getCommentReportsArchive, node_archiveCommentReport, node_removeCommentReport, node_removeCommentReportArchive } = require('../utils/node-communications');

function all_GET(req, res) {
    const jwtToken = req.session.jwtToken;

    node_getCommentReports(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const reports = nodeResponseData.reports;
            
            res.send({isError: false, reports: reports});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function archiveAll_GET(req,res) {
    const jwtToken = req.session.jwtToken;

    node_getCommentReportsArchive(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const reports = nodeResponseData.reports;
            
            res.send({isError: false, reports: reports});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function archive_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    const reportId = req.body.reportId;
    
    node_archiveCommentReport(jwtToken, reportId)
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

function delete_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    const reportId = req.body.reportId;
    
    node_removeCommentReport(jwtToken, reportId)
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

function archiveDelete_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    const archiveId = req.body.archiveId;
    
    node_removeCommentReportArchive(jwtToken, archiveId)
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
    all_GET,
    archiveAll_GET,
    archive_POST,
    delete_POST,
    archiveDelete_POST
}