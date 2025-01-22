const { node_MonetizationAll, node_MonetizationAdd, node_MonetizationDelete } = require('../utils/node-communications');

async function monetizationAll_GET() {
    const result = await node_MonetizationAll();

    return result;
}

async function monetizationAdd_POST(jwtToken, walletAddress, chain, currency) {
    const result = await node_MonetizationAdd(jwtToken, walletAddress, chain, currency);

    return result;
}

async function monetizationDelete_POST(jwtToken, cryptoWalletAddressId) {
    const result = await node_MonetizationDelete(jwtToken, cryptoWalletAddressId);

    return result;
}

module.exports = {
    monetizationAll_GET,
    monetizationAdd_POST,
    monetizationDelete_POST
}