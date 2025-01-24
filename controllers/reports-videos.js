const { 
    node_getVideoReportsArchive, node_archiveVideoReport, node_removeVideoReport, 
    node_removeVideoReportArchive, node_getVideoReports 
} = require('../utils/node-communications');

async function all_GET(jwtToken) {
    const response = await node_getVideoReports(jwtToken);

    return response;
}

async function archiveAll_GET(jwtToken) {
    const response = await node_getVideoReportsArchive(jwtToken);

    return response;
}

async function archive_POST(jwtToken, reportId) {
    const response = await node_archiveVideoReport(jwtToken, reportId);

    return response;
}

async function delete_POST(jwtToken, reportId) {
    const response = await node_removeVideoReport(jwtToken, reportId);

    return response;
}

async function archiveDelete_POST(jwtToken, archiveId) {
    const response = await node_removeVideoReportArchive(jwtToken, archiveId);

    return response;
}

module.exports = {
    all_GET,
    archiveAll_GET,
    archive_POST,
    delete_POST,
    archiveDelete_POST
};