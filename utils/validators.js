function isPublicNodeAddressValid(publicNodeAddress) {
    return publicNodeAddress != null && publicNodeAddress.length > 0 && publicNodeAddress.length <= 100;
}

function isPortValid(port) {
    port = Number(port);
    
    return port != null && !Number.isNaN(port) && (port > 0 && port <= 65535);
}

module.exports = {
    isPublicNodeAddressValid,
    isPortValid
};