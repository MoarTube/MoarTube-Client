const { node_MonetizationAll, node_MonetizationAdd, node_MonetizationDelete } = require('../utils/node-communications');

async function monetizationAll_GET() {
    const response = await node_MonetizationAll();

    return response;
}

async function monetizationAdd_POST(jwtToken, walletAddress, chain, currency) {
    const response = await node_MonetizationAdd(jwtToken, walletAddress, chain, currency);

    return response;
}

async function monetizationDelete_POST(jwtToken, cryptoWalletAddressId) {
    const response = await node_MonetizationDelete(jwtToken, cryptoWalletAddressId);

    return response;
}

module.exports = {
    monetizationAll_GET,
    monetizationAdd_POST,
    monetizationDelete_POST
}