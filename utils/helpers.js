const path = require('path');
const fs = require('fs');
const webSocket = require('ws');

let userDirectory;
let publicDirectory;
let tempDirectory;
let tempCertificatesDirectory;
let tempVideosDirectory;
let moartubeClientPort;
let moartubeNodeIp;
let moartubeNodePort;
let moartubeNodeHttpProtocol;
let moartubeNodeWebsocketProtocol;

let ffmpegPath;

let websocketServer;
let websocketClient;

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
    
    let errorMessage = '<message: ' + message + ', date: ' + humanReadableTimestamp + '>';

    if(error != null) {
        if(error.message != null) {
            errorMessage += '\n' + error.message + '\n';
        }

        if(error.stack != null) {
            errorMessage += '\n' + error.stack + '\n';
        }
        else if(error.stackTrace != null) {
            errorMessage += '\n' + error.stackTrace + '\n';
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

function createRequiredAssets() {
    if (!fs.existsSync(getUserDirectoryPath())) {
		fs.mkdirSync(getUserDirectoryPath(), { recursive: true });
	}

	if (!fs.existsSync(getTempCertificatesDirectoryPath())) {
		fs.mkdirSync(getTempCertificatesDirectoryPath(), { recursive: true });
	}

	if (!fs.existsSync(getTempVideosDirectoryPath())) {
		fs.mkdirSync(getTempVideosDirectoryPath(), { recursive: true });
	}

	if (!fs.existsSync(path.join(getUserDirectoryPath(), '_client_settings.json'))) {
		fs.writeFileSync(path.join(getUserDirectoryPath(), '_client_settings.json'), JSON.stringify({
			"processingAgent":{
				"processingAgentType":"cpu",
				"processingAgentName":"",
				"processingAgentModel":""
			}
		}));
	}
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

function setFfmpegPath(value) {
    if(fs.existsSync(value)) {
        ffmpegPath = value;

        logDebugMessageToConsole('using ffmpeg at path: ' + ffmpegPath, null, null, true);
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

function getUserDirectoryPath() {
    return userDirectory;
}

function getPublicDirectoryPath() {
    return publicDirectory;
}

function getTempDirectoryPath() {
    return tempDirectory;
}

function getTempCertificatesDirectoryPath() {
    return tempCertificatesDirectory;
}

function getTempVideosDirectoryPath() {
    return tempVideosDirectory;
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
	const clientSettings = JSON.parse(fs.readFileSync(path.join(getUserDirectoryPath(), '_client_settings.json'), 'utf8'));

	return clientSettings;
}

function getWebsocketServer() {
    return websocketServer;
}

function getWebsocketClient() {
    return websocketClient;
}


/* setters */

function setPublicDirectoryPath(path) {
    publicDirectory = path;
}

function setUserDirectoryPath(path) {
    userDirectory = path;
}

function setTempDirectoryPath(path) {
    tempDirectory = path;
}

function setTempCertificatesDirectoryPath(path) {
    tempCertificatesDirectory = path;
}

function setTempVideosDirectoryPath(path) {
    tempVideosDirectory = path;
}

function setMoarTubeClientPort(port) {
    moartubeClientPort = port;
}

function setMoarTubeNodeIp(ip) {
    moartubeNodeIp = ip;
}

function setMoarTubeNodePort(port) {
    moartubeNodePort = port;
}

function setMoarTubeNodeHttpProtocol(httpProtocol) {
    moartubeNodeHttpProtocol = httpProtocol;
}

function setMoarTubeNodeWebsocketProtocol(websocketprotocol) {
    moartubeNodeWebsocketProtocol = websocketprotocol;
}

function setClientSettings(clientSettings) {
	fs.writeFileSync(path.join(getUserDirectoryPath(), '_client_settings.json'), JSON.stringify(clientSettings));
}

function setWebsocketServer(wss) {
    websocketServer = wss;
}

function setWebsocketClient(wsc) {
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
    createRequiredAssets,
    cleanVideosDirectory,
    websocketClientBroadcast,
    websocketServerBroadcast,
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
    getFfmpegPath,
    getWebsocketServer,
    getWebsocketClient,
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
    setClientSettings,
    setFfmpegPath,
    setWebsocketServer,
    setWebsocketClient
};