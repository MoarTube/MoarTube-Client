const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_getVideoReportsArchive, node_archiveVideoReport, node_removeVideoReport, node_removeVideoReportArchive, node_getVideoReports } = require('../utils/node-communications');

async function all_GET(jwtToken) {
    const result = await node_getVideoReports(jwtToken);

    return result;
}

async function archiveAll_GET(jwtToken) {
    const result = await node_getVideoReportsArchive(jwtToken);

    return result;
}

async function archive_POST(jwtToken, reportId) {
    const result = await node_archiveVideoReport(jwtToken, reportId);

    return result;
}

async function delete_POST(jwtToken, reportId) {
    const result = await node_removeVideoReport(jwtToken, reportId);

    return result;
}

async function archiveDelete_POST(jwtToken, archiveId) {
    const result = await node_removeVideoReportArchive(jwtToken, archiveId);

    return result;
}

module.exports = {
    all_GET,
    archiveAll_GET,
    archive_POST,
    delete_POST,
    archiveDelete_POST
};