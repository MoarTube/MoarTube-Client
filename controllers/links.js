const { node_LinksAll, node_LinksAdd, node_LinksDelete} = require('../utils/node-communications');

async function linksAll_GET() {
    const response = await node_LinksAll();

    return response;
}

async function linksAdd_POST(jwtToken, url, svgGraphic) {
    const response = await node_LinksAdd(jwtToken, url, svgGraphic);

    return response;
}

async function linksDelete_POST(jwtToken, linkId) {
    const response = await node_LinksDelete(jwtToken, linkId);

    return response;
}

module.exports = {
    linksAll_GET,
    linksAdd_POST,
    linksDelete_POST
}