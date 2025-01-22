const { node_getCommentReports, node_getCommentReportsArchive, node_archiveCommentReport, node_removeCommentReport, node_removeCommentReportArchive } = require('../utils/node-communications');

async function all_GET(jwtToken) {
    const result = await node_getCommentReports(jwtToken);

    return result;
}

async function archiveAll_GET(jwtToken) {
    const result = await node_getCommentReportsArchive(jwtToken);

    return result;
}

async function archive_POST(jwtToken, reportId) {
    const result = await node_archiveCommentReport(jwtToken, reportId);

    return result;
}

async function delete_POST(jwtToken, reportId) {
    const result = await node_removeCommentReport(jwtToken, reportId);

    return result;
}

async function archiveDelete_POST(jwtToken, archiveId) {
    const result = await node_removeCommentReportArchive(jwtToken, archiveId);

    return result;
}

module.exports = {
    all_GET,
    archiveAll_GET,
    archive_POST,
    delete_POST,
    archiveDelete_POST
}