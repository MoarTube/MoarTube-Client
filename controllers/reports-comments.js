const { node_getCommentReports, node_getCommentReportsArchive, node_archiveCommentReport, node_removeCommentReport, node_removeCommentReportArchive } = require('../utils/node-communications');

async function all_GET(jwtToken) {
    const response = await node_getCommentReports(jwtToken);

    return response;
}

async function archiveAll_GET(jwtToken) {
    const response = await node_getCommentReportsArchive(jwtToken);

    return response;
}

async function archive_POST(jwtToken, reportId) {
    const response = await node_archiveCommentReport(jwtToken, reportId);

    return response;
}

async function delete_POST(jwtToken, reportId) {
    const response = await node_removeCommentReport(jwtToken, reportId);

    return response;
}

async function archiveDelete_POST(jwtToken, archiveId) {
    const response = await node_removeCommentReportArchive(jwtToken, archiveId);

    return response;
}

module.exports = {
    all_GET,
    archiveAll_GET,
    archive_POST,
    delete_POST,
    archiveDelete_POST
}