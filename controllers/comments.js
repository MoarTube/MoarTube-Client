const { node_getVideoComments, node_removeComment, node_searchComments } = require('../utils/node-communications');

async function search_GET(jwtToken, videoId, searchTerm, limit, timestamp) {
    const response = await node_searchComments(jwtToken, videoId, searchTerm, limit, timestamp);

    return response;
}

async function videoId_GET(jwtToken, videoId, timestamp, type, sort) {
    const response = await node_getVideoComments(jwtToken, videoId, timestamp, type, sort);

    return response;
}

async function delete_POST(jwtToken, videoId, commentId, timestamp) {
    const response = await node_removeComment(jwtToken, videoId, commentId, timestamp);

    return response;
}

module.exports = {
    search_GET,
    videoId_GET,
    delete_POST
}