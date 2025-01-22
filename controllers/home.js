const { getNetworkAddresses } = require('../utils/helpers');

function network_GET() {
    const networkAddresses = getNetworkAddresses();

    return { isError: false, networkAddresses: networkAddresses };
}

module.exports = {
    network_GET
}