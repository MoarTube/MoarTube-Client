let USER_DIRECTORY;
let PUBLIC_DIRECTORY;
let TEMP_DIRECTORY;
let TEMP_CERTIFICATES_DIRECTORY;
let TEMP_VIDEOS_DIRECTORY;
let MOARTUBE_CLIENT_PORT;
let MOARTUBE_NODE_IP;
let MOARTUBE_NODE_PORT;
let MOARTUBE_NODE_HTTP_PROTOCOL;
let MOARTUBE_NODE_WEBSOCKET_PROTOCOL;

function logDebugMessageToConsole(message, error, stackTrace, isLoggingToFile) {
    const date = new Date(Date.now());
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    const hours = ('0' + date.getHours()).slice(-2);
    const minutes = ('0' + date.getMinutes()).slice(-2);
    const seconds = ('0' + date.getSeconds()).slice(-2);
    const humanReadableTimestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    if(message == null) {
        message = 'none';
    }
    
    var errorMessage = '<message: ' + message + ', date: ' + humanReadableTimestamp + '>';

    if(error != null) {
        if(typeof error === Error) {
            errorMessage += '\n' + error.message + '\n';
        }
        else {
            errorMessage += '\n' + error + '\n';
        }
    }

    if(stackTrace != null) {
        errorMessage += '\n' + stackTrace + '\n';
    }
    
    console.log(errorMessage);
    
    errorMessage += '\n';

    /*
    if(isLoggingToFile) {
        const logFilePath = path.join(__dirname, '/_client_log.txt');
        
        fs.appendFileSync(logFilePath, errorMessage);
    }
    */
}

function deleteDirectoryRecursive(directoryPath) {
    const fs = require('fs');
    const path = require('path');

    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file) => {
            const curPath = path.join(directoryPath, file);
            
            if (fs.statSync(curPath).isDirectory()) {
                deleteDirectoryRecursive(curPath);
            }
            else {
                fs.unlinkSync(curPath);
            }
        });
        
        fs.rmdirSync(directoryPath);
    }
}

function timestampToSeconds(timestamp) {
    const parts = timestamp.split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parseFloat(parts[2]);

    return (hours * 3600) + (minutes * 60) + seconds;
}




/* getters */

function getUserDirectoryPath() {
    return USER_DIRECTORY;
}

function getPublicDirectoryPath() {
    return PUBLIC_DIRECTORY;
}

function getTempDirectoryPath() {
    return TEMP_DIRECTORY;
}

function getTempCertificatesDirectoryPath() {
    return TEMP_CERTIFICATES_DIRECTORY;
}

function getTempVideosDirectoryPath() {
    return TEMP_VIDEOS_DIRECTORY;
}

function getMoarTubeClientPort() {
    return MOARTUBE_CLIENT_PORT;
}

function getMoarTubeNodeIp() {
    return MOARTUBE_NODE_IP;
}

function getMoarTubeNodePort() {
    return MOARTUBE_NODE_PORT;
}

function getMoarTubeNodeHttpProtocol() {
    return MOARTUBE_NODE_HTTP_PROTOCOL;
}

function getMoarTubeNodeWebsocketProtocol() {
    return MOARTUBE_NODE_WEBSOCKET_PROTOCOL;
}

function getMoarTubeNodeUrl() {
    return (getMoarTubeNodeHttpProtocol() + '://' + getMoarTubeNodeIp() + ':' + getMoarTubeNodePort());
}

function getMoarTubeNodeWebsocketUrl() {
    return (getMoarTubeNodeWebsocketProtocol() + '://' + getMoarTubeNodeIp() + ':' + getMoarTubeNodePort());
}


/* setters */

function setPublicDirectoryPath(path) {
    PUBLIC_DIRECTORY = path;
}

function setUserDirectoryPath(path) {
    USER_DIRECTORY = path;
}

function setTempDirectoryPath(path) {
    TEMP_DIRECTORY = path;
}

function setTempCertificatesDirectoryPath(path) {
    TEMP_CERTIFICATES_DIRECTORY = path;
}

function setTempVideosDirectoryPath(path) {
    TEMP_VIDEOS_DIRECTORY = path;
}

function setMoarTubeClientPort(port) {
    MOARTUBE_CLIENT_PORT = port;
}

function setMoarTubeNodeIp(ip) {
    MOARTUBE_NODE_IP = ip;
}

function setMoarTubeNodePort(port) {
    MOARTUBE_NODE_PORT = port;
}

function setMoarTubeNodeHttpProtocol(httpProtocol) {
    MOARTUBE_NODE_HTTP_PROTOCOL = httpProtocol;
}

function setMoarTubeNodeWebsocketProtocol(websocketprotocol) {
    MOARTUBE_NODE_WEBSOCKET_PROTOCOL = websocketprotocol;
}

module.exports = {
    logDebugMessageToConsole,
    deleteDirectoryRecursive,
    timestampToSeconds,
    getUserDirectoryPath,
    getPublicDirectoryPath,
    getTempDirectoryPath,
    getTempCertificatesDirectoryPath,
    getTempVideosDirectoryPath,
    getMoarTubeClientPort,
    getMoarTubeNodeIp,
    getMoarTubeNodePort,
    getMoarTubeNodeHttpProtocol,
    getMoarTubeNodeWebsocketProtocol,
    getMoarTubeNodeUrl,
    getMoarTubeNodeWebsocketUrl,
    setPublicDirectoryPath,
    setUserDirectoryPath,
    setTempDirectoryPath,
    setTempCertificatesDirectoryPath,
    setTempVideosDirectoryPath,
    setMoarTubeClientPort,
    setMoarTubeNodeIp,
    setMoarTubeNodePort,
    setMoarTubeNodeHttpProtocol,
    setMoarTubeNodeWebsocketProtocol
};