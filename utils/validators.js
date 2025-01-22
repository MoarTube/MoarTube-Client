function isPortValid(port) {
    port = Number(port);

    return port != null && !Number.isNaN(port) && (port > 0 && port <= 65535);
}

module.exports = {
    isPortValid
};