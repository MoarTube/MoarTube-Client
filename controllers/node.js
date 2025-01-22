const { node_doVideosSearchAll, node_getNewContentCounts, node_setContentChecked } = require('../utils/node-communications');

async function search_GET(searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    const result = await node_doVideosSearchAll(searchTerm, sortTerm, tagTerm, tagLimit, timestamp);

    return result;
}

async function newContentCounts_GET(jwtToken) {
    const result = await node_getNewContentCounts(jwtToken);

    return result;
}

async function contentChecked_POST(jwtToken, contentType) {
    const result = await node_setContentChecked(jwtToken, contentType);

    return result;
}

module.exports = {
    search_GET,
    newContentCounts_GET,
    contentChecked_POST
}