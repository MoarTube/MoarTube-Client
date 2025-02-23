const path = require('path');
const fs = require('fs');
const fss = require('fs').promises;
const webSocket = require('ws');
const axios = require('axios').default;

let isDeveloperMode;
let publicDirectoryPath;
let viewsDirectoryPath;
let dataDirectoryPath;
let videosDirectoryPath;
let moartubeClientPort;
let moartubeNodeIp;
let moartubeNodePort;
let moartubeNodeHttpProtocol;
let moartubeNodeWebsocketProtocol;

let ffmpegPath;

let websocketServer;
let websocketClient;

let nodeSettings;
let externalVideosBaseUrl;

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

    if (error != null) {
        if (error.stack != null) {
            errorMessage += '\n' + error.stack;
        }
        else if (error.stackTrace != null) {
            errorMessage += '\n' + error.stackTrace;
        }
    }

    if (stackTrace != null) {
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

async function deleteDirectoryRecursive(directoryPath) {
    try {
        await fss.rm(directoryPath, { recursive: true, force: true });
    }
    catch (error) {
        logDebugMessageToConsole('failed to delete directory path: ' + directoryPath, error, null);
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

async function detectSystemGpu() {
    const systemInformation = require('systeminformation');

    const graphics = await systemInformation.graphics();

    let processingAgentName = '';
    let processingAgentModel = '';

    for (const controller of graphics.controllers) {
        if (controller.vendor.toLowerCase().includes('nvidia')) {
            processingAgentName = 'NVIDIA';
            processingAgentModel = controller.model.replace(/^.*\bNVIDIA\s*/, '');

            break;
        }
        else if (controller.vendor.toLowerCase().includes('amd') || controller.vendor.toLowerCase().includes('advanced micro devices')) {
            processingAgentName = 'AMD';
            processingAgentModel = controller.model.replace(/^.*\bAMD\s*/, '');

            break;
        }
        else {
            processingAgentName = 'none';
            processingAgentModel = 'none';

            break;
        }
    }

    return { processingAgentName: processingAgentName, processingAgentModel: processingAgentModel };
}

async function detectSystemCpu() {
    const systemInformation = require('systeminformation');

    const cpu = await systemInformation.cpu();

    const processingAgentName = cpu.manufacturer;
    const processingAgentModel = cpu.brand;

    return { processingAgentName: processingAgentName, processingAgentModel: processingAgentModel };
}

function getNetworkAddresses() {
    const os = require('os');

    const networkInterfaces = os.networkInterfaces();

    const ipv4Addresses = ['127.0.0.1'];
    const ipv6Addresses = ['::1'];

    for (const networkInterfaceKey of Object.keys(networkInterfaces)) {
        const networkInterface = networkInterfaces[networkInterfaceKey];

        for (const networkInterfaceElement of networkInterface) {
            const networkAddress = networkInterfaceElement.address;

            if (networkInterfaceElement.family === 'IPv4' && networkAddress !== '127.0.0.1') {
                ipv4Addresses.push(networkAddress);
            }
            else if (networkInterfaceElement.family === 'IPv6' && networkAddress !== '::1') {
                ipv6Addresses.push(networkAddress);
            }
        }
    }

    const networkAddresses = ipv4Addresses.concat(ipv6Addresses);

    return networkAddresses;
}

async function performEncodingDecodingAssessment() {
    logDebugMessageToConsole('assessing system encoding/decoding capabilities', null, null);

    const systemCpu = await detectSystemCpu();
    const systemGpu = await detectSystemGpu();

    logDebugMessageToConsole('CPU detected: ' + systemCpu.processingAgentName + ' ' + systemCpu.processingAgentModel, null, null);
    logDebugMessageToConsole('GPU detected: ' + systemGpu.processingAgentName + ' ' + systemGpu.processingAgentModel, null, null);
}

async function cleanVideosDirectory() {
    logDebugMessageToConsole('cleaning imported video directories', null, null);

    const videosDirectoryPath = getVideosDirectoryPath();
    await fss.access(videosDirectoryPath).catch(() => {
        throw new Error(`expected path does not exist: ${videosDirectoryPath}`);
    });

    const videoDirectories = await fss.readdir(videosDirectoryPath);
    for (const videoDirectory of videoDirectories) {
        const videoDirectoryPath = path.join(videosDirectoryPath, videoDirectory);

        const stat = await fss.stat(videoDirectoryPath);
        if (!stat.isDirectory()) {
            throw new Error(`expected path is not a directory: ${videoDirectoryPath}`);
        }

        const directories = await fss.readdir(videoDirectoryPath);
        for (const directory of directories) {
            if (directory !== 'source') {
                const directoryPath = path.join(videoDirectoryPath, directory);

                await deleteDirectoryRecursive(directoryPath);
            }
        }
    }
}

async function refreshM3u8MasterManifest(jwtToken, videoId) {
    const { node_getVideoData, node_uploadM3u8MasterManifest } = require('./node-communications');
    const { s3_putObjectFromData } = require('./s3-communications');

    const videoData = (await node_getVideoData(videoId)).videoData;
    const isStreaming = videoData.isStreaming;
    const resolutions = videoData.outputs.m3u8;

    const externalVideosBaseUrl = await getExternalVideosBaseUrl(jwtToken);

    let manifestType;

    if (isStreaming) {
        manifestType = 'dynamic';
    }
    else {
        manifestType = 'static';
    }

    let masterManifest = '#EXTM3U\n#EXT-X-VERSION:3\n';

    for (const resolution of resolutions) {
        if (resolution === '240p') {
            masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=426x240\n';
            masterManifest += externalVideosBaseUrl + '/external/videos/' + videoId + '/adaptive/m3u8/' + manifestType + '/manifests/manifest-240p.m3u8\n';
        }
        else if (resolution === '360p') {
            masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\n';
            masterManifest += externalVideosBaseUrl + '/external/videos/' + videoId + '/adaptive/m3u8/' + manifestType + '/manifests/manifest-360p.m3u8\n';
        }
        else if (resolution === '480p') {
            masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\n';
            masterManifest += externalVideosBaseUrl + '/external/videos/' + videoId + '/adaptive/m3u8/' + manifestType + '/manifests/manifest-480p.m3u8\n';
        }
        else if (resolution === '720p') {
            masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n';
            masterManifest += externalVideosBaseUrl + '/external/videos/' + videoId + '/adaptive/m3u8/' + manifestType + '/manifests/manifest-720p.m3u8\n';
        }
        else if (resolution === '1080p') {
            masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\n';
            masterManifest += externalVideosBaseUrl + '/external/videos/' + videoId + '/adaptive/m3u8/' + manifestType + '/manifests/manifest-1080p.m3u8\n';
        }
        else if (resolution === '1440p') {
            masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=2560x1440\n';
            masterManifest += externalVideosBaseUrl + '/external/videos/' + videoId + '/adaptive/m3u8/' + manifestType + '/manifests/manifest-1440p.m3u8\n';
        }
        else if (resolution === '2160p') {
            masterManifest += '#EXT-X-STREAM-INF:BANDWIDTH=16000000,RESOLUTION=3840x2160\n'
            masterManifest += externalVideosBaseUrl + '/external/videos/' + videoId + '/adaptive/m3u8/' + manifestType + '/manifests/manifest-2160p.m3u8\n';
        }
    }

    const nodeSettings = await getNodeSettings(jwtToken);

    const storageConfig = nodeSettings.storageConfig;
    const storageMode = storageConfig.storageMode;

    if (storageMode === 'filesystem') {
        await node_uploadM3u8MasterManifest(jwtToken, videoId, manifestType, masterManifest);
    }
    else if (storageMode === 's3provider') {
        const s3Config = storageConfig.s3Config;

        const key = 'external/videos/' + videoId + '/adaptive/m3u8/' + manifestType + '/manifests/manifest-master.m3u8';

        await s3_putObjectFromData(s3Config, key, Buffer.from(masterManifest), 'application/vnd.apple.mpegurl');
    }
}

function setFfmpegPath(value) {
    if (fs.existsSync(value)) {
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
    if (websocketClient != null) {
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

function getViewsDirectoryPath() {
    return viewsDirectoryPath;
}

function getDataDirectoryPath() {
    return dataDirectoryPath;
}

function getVideosDirectoryPath() {
    return videosDirectoryPath;
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

function getIsDeveloperMode() {
    return isDeveloperMode;
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

function setViewsDirectoryPath(path) {
    viewsDirectoryPath = path;
}

function setDataDirectoryPath(path) {
    logDebugMessageToConsole('configured MoarTube Client to use data directory path: ' + path, null, null);

    dataDirectoryPath = path;
}

function setVideosDirectoryPath(path) {
    logDebugMessageToConsole('configured MoarTube Client to use videos directory path: ' + path, null, null);

    videosDirectoryPath = path;
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

function setIsDeveloperMode(value) {
    isDeveloperMode = value;
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

function cacheM3u8Segment(segmentFileUrl) {
    axios.get(segmentFileUrl);
}

async function getNodeSettings(jwtToken) {
    if (nodeSettings == null) {
        const {
            node_getSettings
        } = require('./node-communications');

        nodeSettings = (await node_getSettings(jwtToken)).nodeSettings;

        logDebugMessageToConsole('retrieved nodeSettings from MoarTube Node', null, null);
    }

    return nodeSettings;
}

function clearNodeSettingsClientCache() {
    nodeSettings = null;
}

async function getExternalVideosBaseUrl(jwtToken) {
    if (externalVideosBaseUrl == null) {
        const {
            node_getExternalVideosBaseUrl
        } = require('./node-communications');

        externalVideosBaseUrl = (await node_getExternalVideosBaseUrl(jwtToken)).externalVideosBaseUrl;

        logDebugMessageToConsole('retrieved externalVideosBaseUrl from MoarTube Node', null, null);
    }

    return externalVideosBaseUrl;
}

function clearExternalVideosBaseUrlClientCache() {
    externalVideosBaseUrl = null;
}

async function checkNetworkPortStatus(port, host) {
    const portscanner = require('portscanner');

    const portStatus = await portscanner.checkPortStatus(port, host);

    return portStatus;
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
    getViewsDirectoryPath,
    getDataDirectoryPath,
    getVideosDirectoryPath,
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
    setViewsDirectoryPath,
    setDataDirectoryPath,
    setVideosDirectoryPath,
    setMoarTubeClientPort,
    setMoarTubeNodeIp,
    setMoarTubeNodePort,
    setMoarTubeNodeHttpProtocol,
    setMoarTubeNodeWebsocketProtocol,
    setClientSettings,
    setFfmpegPath,
    setWebsocketServer,
    setWebsocketClient,
    getIsDeveloperMode,
    setIsDeveloperMode,
    refreshM3u8MasterManifest,
    cacheM3u8Segment,
    getNodeSettings,
    clearNodeSettingsClientCache,
    getExternalVideosBaseUrl,
    clearExternalVideosBaseUrlClientCache,
    checkNetworkPortStatus
};