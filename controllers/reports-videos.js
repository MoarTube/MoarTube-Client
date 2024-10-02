const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_getVideoReportsArchive, node_archiveVideoReport, node_removeVideoReport, node_removeVideoReportArchive, node_getVideoReports } = require('../utils/node-communications');

function all_GET(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_getVideoReports(jwtToken)
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
        node_getVideoReportsArchive(jwtToken)
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
        node_archiveVideoReport(jwtToken, reportId)
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
        node_removeVideoReport(jwtToken, reportId)
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
        node_removeVideoReportArchive(jwtToken, archiveId)
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
};