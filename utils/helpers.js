const path = require('path');
const fs = require('fs');

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

function detectOperatingSystem() {
    const os = require('os');
    
    const platform = os.platform();
    
    return platform;
}

function detectSystemGpu() {
    return new Promise(function(resolve, reject) {
        const systemInformation = require('systeminformation');
        
        systemInformation.graphics()
        .then(function(data) {
            var processingAgentName = '';
            var processingAgentModel = '';
            
            data.controllers.forEach(function(controller) {
                if(controller.vendor.toLowerCase().includes('nvidia')) {
                    processingAgentName = 'NVIDIA';
                    processingAgentModel = controller.model.replace(/^.*\bNVIDIA\s*/, '');
                    
                    return;
                }
                else if(controller.vendor.toLowerCase().includes('amd') || controller.vendor.toLowerCase().includes('advanced micro devices')) {
                    processingAgentName = 'AMD';
                    processingAgentModel = controller.model.replace(/^.*\bAMD\s*/, '');
                    
                    return;
                }
                else {
                    processingAgentName = 'none';
                    processingAgentModel = 'none';
                    
                    return;
                }
            });
            
            resolve({processingAgentName: processingAgentName, processingAgentModel: processingAgentModel});
        })
        .catch(function(error) {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            reject(error);
        });
    });
}

function detectSystemCpu() {
    return new Promise(function(resolve, reject) {
        const systemInformation = require('systeminformation');
        
        systemInformation.cpu()
        .then(function(data) {
            const processingAgentName = data.manufacturer;
            const processingAgentModel = data.brand;
            
            resolve({processingAgentName: processingAgentName, processingAgentModel: processingAgentModel});
        })
        .catch(function(error) {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            reject(error);
        });
    });
}

function getNetworkAddresses() {
    const os = require('os');
    
    const networkInterfaces = os.networkInterfaces();

    const ipv4Addresses = ['127.0.0.1'];
    const ipv6Addresses = ['::1'];
    
    for(const networkInterfaceKey of Object.keys(networkInterfaces)) {
        const networkInterface = networkInterfaces[networkInterfaceKey];
        
        for(const networkInterfaceElement of networkInterface) {
            const networkAddress = networkInterfaceElement.address;

            if(networkInterfaceElement.family === 'IPv4' && networkAddress !== '127.0.0.1') {
                ipv4Addresses.push(networkAddress);
            }
            else if(networkInterfaceElement.family === 'IPv6' && networkAddress !== '::1') {
                ipv6Addresses.push(networkAddress);
            }
        }
    }

    const networkAddresses = ipv4Addresses.concat(ipv6Addresses);
    
    return networkAddresses;
}

function performEncodingDecodingAssessment() {
    return new Promise(async function(resolve, reject) {
        logDebugMessageToConsole('assessing system encoding/decoding capabilities', null, null, true);
        
        try {
            const systemCpu = await detectSystemCpu();
            const systemGpu = await detectSystemGpu();
            
            logDebugMessageToConsole('CPU detected: ' + systemCpu.processingAgentName + ' ' + systemCpu.processingAgentModel, null, null, true);
            logDebugMessageToConsole('GPU detected: ' + systemGpu.processingAgentName + ' ' + systemGpu.processingAgentModel, null, null, true);
            
            resolve();
        }
        catch(error) {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            process.exit();
        }
    });
}

function cleanVideosDirectory() {
    return new Promise(function(resolve, reject) {
        logDebugMessageToConsole('cleaning imported video directories', null, null, true);
        
        if(fs.existsSync(getTempVideosDirectoryPath())) {
            fs.readdir(getTempVideosDirectoryPath(), function(error, videoDirectories) {
                if (error) {
                    reject(error);
                }
                else {
                    if(videoDirectories.length === 0) {
                        resolve();
                    }
                    else {
                        for(const videoDirectory of videoDirectories) {
                            const videoDirectoryPath = path.join(getTempVideosDirectoryPath(), videoDirectory);
                            
                            if(fs.existsSync(videoDirectoryPath)) {
                                if (fs.statSync(videoDirectoryPath).isDirectory()) {
                                    fs.readdir(videoDirectoryPath, function(error, directories) {
                                        if (error) {
                                            reject(error);
                                        }
                                        else {
                                            for(directory of directories) {
                                                if(directory !== 'source') {
                                                    const directoryPath = path.join(videoDirectoryPath, directory);
                                                    
                                                    deleteDirectoryRecursive(directoryPath);
                                                }
                                            }
                                            
                                            resolve();
                                        }
                                    });
                                }
                            }
                            else {
                                reject('expected path does not exist: ' + videoDirectoryPath);
                            }
                        }
                    }
                }
            });
        }
        else {
            reject('expected path does not exist: ' + getTempVideosDirectoryPath());
        }
    });
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

function getClientSettings() {
	const clientSettings = JSON.parse(fs.readFileSync(path.join(getUserDirectoryPath(), '_client_settings.json'), 'utf8'));

	return clientSettings;
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

function setClientSettings(clientSettings) {
	fs.writeFileSync(path.join(getUserDirectoryPath(), '_client_settings.json'), JSON.stringify(clientSettings));
}

module.exports = {
    logDebugMessageToConsole,
    deleteDirectoryRecursive,
    timestampToSeconds,
    detectOperatingSystem,
    detectSystemGpu,
    detectSystemCpu,
    getNetworkAddresses,
    performEncodingDecodingAssessment,
    cleanVideosDirectory,
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
    getClientSettings,
    setPublicDirectoryPath,
    setUserDirectoryPath,
    setTempDirectoryPath,
    setTempCertificatesDirectoryPath,
    setTempVideosDirectoryPath,
    setMoarTubeClientPort,
    setMoarTubeNodeIp,
    setMoarTubeNodePort,
    setMoarTubeNodeHttpProtocol,
    setMoarTubeNodeWebsocketProtocol,
    setClientSettings
};