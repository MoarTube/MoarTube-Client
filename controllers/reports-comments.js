const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_getCommentReports, node_getCommentReportsArchive, node_archiveCommentReport, node_removeCommentReport, node_removeCommentReportArchive } = require('../utils/node-communications');

function all_GET(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_getCommentReports(jwtToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const reports = nodeResponseData.reports;
                
                resolve({isError: false, reports: reports});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function archiveAll_GET(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_getCommentReportsArchive(jwtToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const reports = nodeResponseData.reports;
                
                resolve({isError: false, reports: reports});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function archive_POST(jwtToken, reportId) {
    return new Promise(function(resolve, reject) {
        node_archiveCommentReport(jwtToken, reportId)
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
            reject(error);
        });
    });
}

function delete_POST(jwtToken, reportId) {
    return new Promise(function(resolve, reject) {
        node_removeCommentReport(jwtToken, reportId)
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
            reject(error);
        });
    });
}

function archiveDelete_POST(jwtToken, archiveId) {
    return new Promise(function(resolve, reject) {
        node_removeCommentReportArchive(jwtToken, archiveId)
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
            reject(error);
        });
    });
}

module.exports = {
    all_GET,
    archiveAll_GET,
    archive_POST,
    delete_POST,
    archiveDelete_POST
}