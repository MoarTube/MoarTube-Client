const { node_LinksAll, node_LinksAdd, node_LinksDelete} = require('../utils/node-communications');

async function linksAll_GET() {
    const result = await node_LinksAll();

    return result;
}

async function linksAdd_POST(jwtToken, url, svgGraphic) {
    const result = await node_LinksAdd(jwtToken, url, svgGraphic);

    return result;
}

async function linksDelete_POST(jwtToken, linkId) {
    const result = await node_LinksDelete(jwtToken, linkId);

    return result;
}

module.exports = {
    linksAll_GET,
    linksAdd_POST,
    linksDelete_POST
}