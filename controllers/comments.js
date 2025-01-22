const { node_getVideoComments, node_removeComment, node_searchComments } = require('../utils/node-communications');

async function search_GET(jwtToken, videoId, searchTerm, limit, timestamp) {
    const result = await node_searchComments(jwtToken, videoId, searchTerm, limit, timestamp);

    return result;
}

async function videoId_GET(jwtToken, videoId, timestamp, type, sort) {
    const result = await node_getVideoComments(jwtToken, videoId, timestamp, type, sort);

    return result;
}

async function delete_POST(jwtToken, videoId, commentId, timestamp) {
    const result = await node_removeComment(jwtToken, videoId, commentId, timestamp);

    return result;
}

module.exports = {
    search_GET,
    videoId_GET,
    delete_POST
}