const path = require('path');
const fs = require('fs');
const webSocket = require('ws');

let publicDirectoryPath;
let dataDirectoryPath;
let certificatesDirectoryPath;
let videosDirectoryPath;
let imagesDirectoryPath;
let moartubeClientPort;
let moartubeNodeIp;
let moartubeNodePort;
let moartubeNodeHttpProtocol;
let moartubeNodeWebsocketProtocol;

let ffmpegPath;

let websocketServer;
let websocketClient;

function logDebugMessageToConsole(message, error, stackTrace) {
    const date = new Date(Date.now());
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    const hours = ('0' + date.getHours()).slice(-2);
    const minutes = ('0' + date.getMinutes()).slice(-2);
    const seconds = ('0' + date.getSeconds()).slice(-2);
    const humanReadableTimestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    
    let errorMessage = '<message: ' + message + ', date: ' + humanReadableTimestamp + '>';

    if(error != null) {
        if(error.stack != null) {
            errorMessage += '\n' + error.stack;
        }
        else if(error.stackTrace != null) {
            errorMessage += '\n' + error.stackTrace;
        }
    }

    if(stackTrace != null) {
        errorMessage += '\n' + stackTrace;
    }
    
    console.log(errorMessage);

    errorMessage += '\n';
    
    /*
    if(isLoggingToFile) {
        const logFilePath = path.join(__dirname, '/_node_log.txt');
        fs.appendFileSync(logFilePath, errorMessage);
    }
    */
}

function deleteDirectoryRecursive(directoryPath) {
    return new Promise(function(resolve, reject) {
        fs.rm(directoryPath, { recursive: true, force: true }, function(error) {
            // do nothing, best effort

            resolve();
        });
    });
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
            let processingAgentName = '';
            let processingAgentModel = '';
            
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
            logDebugMessageToConsole(null, error, new Error().stack);
            
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
            logDebugMessageToConsole(null, error, new Error().stack);
            
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
        logDebugMessageToConsole('assessing system encoding/decoding capabilities', null, null);
        
        try {
            const systemCpu = await detectSystemCpu();
            const systemGpu = await detectSystemGpu();
            
            logDebugMessageToConsole('CPU detected: ' + systemCpu.processingAgentName + ' ' + systemCpu.processingAgentModel, null, null);
            logDebugMessageToConsole('GPU detected: ' + systemGpu.processingAgentName + ' ' + systemGpu.processingAgentModel, null, null);
            
            resolve();
        }
        catch(error) {
            logDebugMessageToConsole(null, error, new Error().stack);
            
            process.exit();
        }
    });
}

function cleanVideosDirectory() {
    return new Promise(function(resolve, reject) {
        logDebugMessageToConsole('cleaning imported video directories', null, null);
        
        if(fs.existsSync(getVideosDirectoryPath())) {
            fs.readdir(getVideosDirectoryPath(), function(error, videoDirectories) {
                if (error) {
                    reject(error);
                }
                else {
                    if(videoDirectories.length === 0) {
                        resolve();
                    }
                    else {
                        for(const videoDirectory of videoDirectories) {
                            const videoDirectoryPath = path.join(getVideosDirectoryPath(), videoDirectory);
                            
                            if(fs.existsSync(videoDirectoryPath)) {
                                if (fs.statSync(videoDirectoryPath).isDirectory()) {
                                    fs.readdir(videoDirectoryPath, async function(error, directories) {
                                        if (error) {
                                            reject(error);
                                        }
                                        else {
                                            for(const directory of directories) {
                                                if(directory !== 'source') {
                                                    const directoryPath = path.join(videoDirectoryPath, directory);
                                                    
                                                    await deleteDirectoryRecursive(directoryPath);
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
            reject('expected path does not exist: ' + getVideosDirectoryPath());
        }
    });
}

function setFfmpegPath(value) {
    if(fs.existsSync(value)) {
        ffmpegPath = value;

        const execSync = require('child_process').execSync;
        
        logDebugMessageToConsole('using ffmpeg at path: ' + ffmpegPath, null, null);

        logDebugMessageToConsole(execSync(getFfmpegPath() + ' -version').toString(), null, null);
    }
    else {
        throw new Error('ffmpeg does not exist at path: ' + value);
    }
}

function getFfmpegPath() {
    return ffmpegPath;
}

function websocketClientBroadcast(message) {
    if(websocketClient != null) {
        websocketClient.send(JSON.stringify(message));
    }
}

function websocketServerBroadcast(message) {
    websocketServer.clients.forEach(function each(client) {
        if (client.readyState === webSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}





/* getters */

function getPublicDirectoryPath() {
    return publicDirectoryPath;
}

function getDataDirectoryPath() {
    return dataDirectoryPath;
}

function getCertificatesDirectoryPath() {
    return certificatesDirectoryPath;
}

function getVideosDirectoryPath() {
    return videosDirectoryPath;
}

function getImagesDirectoryPath() {
    return imagesDirectoryPath;
}

function getMoarTubeClientPort() {
    return moartubeClientPort;
}

function getMoarTubeNodeIp() {
    return moartubeNodeIp;
}

function getMoarTubeNodePort() {
    return moartubeNodePort;
}

function getMoarTubeNodeHttpProtocol() {
    return moartubeNodeHttpProtocol;
}

function getMoarTubeNodeWebsocketProtocol() {
    return moartubeNodeWebsocketProtocol;
}

function getMoarTubeNodeUrl() {
    return (getMoarTubeNodeHttpProtocol() + '://' + getMoarTubeNodeIp() + ':' + getMoarTubeNodePort());
}

function getMoarTubeNodeWebsocketUrl() {
    return (getMoarTubeNodeWebsocketProtocol() + '://' + getMoarTubeNodeIp() + ':' + getMoarTubeNodePort());
}

function getClientSettings() {
	const clientSettings = JSON.parse(fs.readFileSync(path.join(getDataDirectoryPath(), '_client_settings.json'), 'utf8'));

	return clientSettings;
}

function getClientSettingsDefault() {
	const clientSettingsDefault = JSON.parse(fs.readFileSync(path.join(getDataDirectoryPath(), '_client_settings_default.json'), 'utf8'));

	return clientSettingsDefault;
}

function getWebsocketServer() {
    return websocketServer;
}

function getWebsocketClient() {
    return websocketClient;
}


/* setters */

function setPublicDirectoryPath(path) {
    logDebugMessageToConsole('configured MoarTube Client to use public directory path: ' + path, null, null);

    publicDirectoryPath = path;
}

function setDataDirectoryPath(path) {
    logDebugMessageToConsole('configured MoarTube Client to use data directory path: ' + path, null, null);

    dataDirectoryPath = path;
}

function setCertificatesDirectoryPath(path) {
    logDebugMessageToConsole('configured MoarTube Client to use certificates directory path: ' + path, null, null);

    certificatesDirectoryPath = path;
}

function setVideosDirectoryPath(path) {
    logDebugMessageToConsole('configured MoarTube Client to use videos directory path: ' + path, null, null);

    videosDirectoryPath = path;
}

function setImagesDirectoryPath(path) {
    logDebugMessageToConsole('configured MoarTube Client to use images directory path: ' + path, null, null);

    imagesDirectoryPath = path;
}

function setMoarTubeClientPort(port) {
    logDebugMessageToConsole('configured MoarTube Client to use port: ' + port, null, null);
    
    moartubeClientPort = port;
}

function setMoarTubeNodeIp(ip) {
    logDebugMessageToConsole('configured MoarTube Client to use MoarTube Node ip: ' + ip, null, null);

    moartubeNodeIp = ip;
}

function setMoarTubeNodePort(port) {
    logDebugMessageToConsole('configured MoarTube Client to use MoarTube Node port: ' + port, null, null);

    moartubeNodePort = port;
}

function setMoarTubeNodeHttpProtocol(httpProtocol) {
    logDebugMessageToConsole('configured MoarTube Client to use MoarTube Node http protocol: ' + httpProtocol, null, null);

    moartubeNodeHttpProtocol = httpProtocol;
}

function setMoarTubeNodeWebsocketProtocol(websocketprotocol) {
    logDebugMessageToConsole('configured MoarTube Client to use MoarTube Node websocket protocol: ' + websocketprotocol, null, null);

    moartubeNodeWebsocketProtocol = websocketprotocol;
}

function setClientSettings(clientSettings) {
    const clientSettingsString = JSON.stringify(clientSettings);

    logDebugMessageToConsole('configured MoarTube Client to use client settings: ' + clientSettingsString, null, null);

	fs.writeFileSync(path.join(getDataDirectoryPath(), '_client_settings.json'), clientSettingsString);
}

function setWebsocketServer(wss) {
    logDebugMessageToConsole('configured MoarTube Client with websocket server', null, null);

    websocketServer = wss;
}

function setWebsocketClient(wsc) {
    logDebugMessageToConsole('configured MoarTube Client with websocket client', null, null);

    websocketClient = wsc;
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
    websocketClientBroadcast,
    websocketServerBroadcast,
    getPublicDirectoryPath,
    getDataDirectoryPath,
    getCertificatesDirectoryPath,
    getVideosDirectoryPath,
    getImagesDirectoryPath,
    getMoarTubeClientPort,
    getMoarTubeNodeIp,
    getMoarTubeNodePort,
    getMoarTubeNodeHttpProtocol,
    getMoarTubeNodeWebsocketProtocol,
    getMoarTubeNodeUrl,
    getMoarTubeNodeWebsocketUrl,
    getClientSettings,
    getClientSettingsDefault,
    getFfmpegPath,
    getWebsocketServer,
    getWebsocketClient,
    setPublicDirectoryPath,
    setDataDirectoryPath,
    setCertificatesDirectoryPath,
    setVideosDirectoryPath,
    setImagesDirectoryPath,
    setMoarTubeClientPort,
    setMoarTubeNodeIp,
    setMoarTubeNodePort,
    setMoarTubeNodeHttpProtocol,
    setMoarTubeNodeWebsocketProtocol,
    setClientSettings,
    setFfmpegPath,
    setWebsocketServer,
    setWebsocketClient
};