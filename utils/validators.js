function isPortValid(port) {
    port = Number(port);
    
    return port != null && !Number.isNaN(port) && (port > 0 && port <= 65535);
}

function isIpv4Address(value) {
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;

    return ipv4Regex.test(value);
}

module.exports = {
    isPortValid,
    isIpv4Address
};