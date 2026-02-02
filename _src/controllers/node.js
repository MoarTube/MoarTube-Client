const { 
    node_doVideosSearchAll, node_getNewContentCounts, node_setContentChecked 
} = require('../utils/node-communications');

async function search_GET(searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    const response = await node_doVideosSearchAll(searchTerm, sortTerm, tagTerm, tagLimit, timestamp);

    return response;
}

async function newContentCounts_GET(jwtToken) {
    const response = await node_getNewContentCounts(jwtToken);

    return response;
}

async function contentChecked_POST(jwtToken, contentType) {
    const response = await node_setContentChecked(jwtToken, contentType);

    return response;
}

module.exports = {
    search_GET,
    newContentCounts_GET,
    contentChecked_POST
}