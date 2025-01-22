const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const packageJson = require('../package.json');

sharp.cache(false);

const { 
    setMoarTubeNodeHttpProtocol, setMoarTubeNodeWebsocketProtocol, setMoarTubeNodePort, detectOperatingSystem, detectSystemGpu, 
    detectSystemCpu, getClientSettings, setClientSettings, getImagesDirectoryPath, getClientSettingsDefault, clearNodeSettingsClientCache, getNodeSettings,
    clearExternalVideosBaseUrlClientCache, getExternalVideosBaseUrl
} = require('../utils/helpers');
const { 
    node_setExternalNetwork, node_getAvatar, node_setAvatar, node_getBanner, node_setBanner, node_setNodeName, node_setNodeAbout, 
    node_setNodeId, node_setSecureConnection, node_setNetworkInternal, node_setAccountCredentials, node_setCloudflareConfiguration, 
    node_clearCloudflareConfiguration, node_setCloudflareTurnstileConfiguration, node_CloudflareTurnstileConfigurationClear,
    node_commentsToggle, node_likesToggle, node_dislikesToggle, node_reportsToggle, node_liveChatToggle, node_databaseConfigToggle,
    node_databaseConfigEmpty, node_storageConfigToggle, node_storageConfigEmpty, node_getVideoDataOutputs
} = require('../utils/node-communications');

const {
    s3_validateS3Config, s3_updateM3u8ManifestsWithExternalVideosBaseUrl
} = require('../utils/s3-communications');

function client_GET() {
    const settings = {
        isGpuAccelerationEnabled: false
    };
    
    const clientSettings = getClientSettings();

    settings.version = packageJson.version;
    
    if(clientSettings.processingAgent.processingAgentType === 'gpu') {
        settings.isGpuAccelerationEnabled = true;
        settings.gpuVendor = clientSettings.processingAgent.processingAgentName;
        settings.gpuModel = clientSettings.processingAgent.processingAgentModel;
    }

    settings.videoEncoderSettings = clientSettings.videoEncoderSettings;
    settings.liveEncoderSettings = clientSettings.liveEncoderSettings;

    return {isError: false, clientSettings: settings};
}

async function node_GET(jwtToken) {
    const response = await getNodeSettings(jwtToken);

    return response;
}

async function clientGpuAcceleration_POST(isGpuAccelerationEnabled) {
    const operatingSystem = detectOperatingSystem();
    
    if(operatingSystem === 'win32') {
        const clientSettings = getClientSettings();
        
        const result = {};
        
        if(isGpuAccelerationEnabled) {
            const systemGpu = await detectSystemGpu();

            clientSettings.processingAgent.processingAgentType = 'gpu';
            clientSettings.processingAgent.processingAgentName = systemGpu.processingAgentName;
            clientSettings.processingAgent.processingAgentModel = systemGpu.processingAgentModel;

            setClientSettings(clientSettings);
            
            result.isGpuAccelerationEnabled = true;
            result.gpuVendor = systemGpu.processingAgentName;
            result.gpuModel = systemGpu.processingAgentModel;
        }
        else {
            const systemCpu = await detectSystemCpu();

            clientSettings.processingAgent.processingAgentType = 'cpu';
            clientSettings.processingAgent.processingAgentName = systemCpu.processingAgentName;
            clientSettings.processingAgent.processingAgentModel = systemCpu.processingAgentModel;

            setClientSettings(clientSettings);
            
            result.isGpuAccelerationEnabled = false;
        }

        return {isError: false, result: result}
    }
    else {
        return {isError: true, message: 'this version of MoarTube Client only supports GPU acceleration on Windows platforms'};
    }
}

function clientEncodingDefault_GET() {
    const clientSettingsDefault = getClientSettingsDefault();

    const videoEncoderSettings = clientSettingsDefault.videoEncoderSettings;
    const liveEncoderSettings = clientSettingsDefault.liveEncoderSettings;

    return {isError: false, videoEncoderSettings: videoEncoderSettings, liveEncoderSettings: liveEncoderSettings};
}

function clientEncoding_POST(videoEncoderSettings, liveEncoderSettings) {
    const clientSettings = getClientSettings();

    clientSettings.videoEncoderSettings = videoEncoderSettings;
    clientSettings.liveEncoderSettings = liveEncoderSettings;

    setClientSettings(clientSettings);

    return {isError: false};
}



async function nodeAvatar_GET() {
    const response = await node_getAvatar();

    return response;
}

async function nodeAvatar_POST(jwtToken, avatarFile) {
    let result;

    if(avatarFile != null && avatarFile.length === 1) {
        avatarFile = avatarFile[0];

        const imagesDirectory = getImagesDirectoryPath();
        
        const sourceFilePath = path.join(imagesDirectory, avatarFile.filename);
        
        const iconDestinationFilePath = path.join(imagesDirectory, 'icon.png');
        const avatarDestinationFilePath = path.join(imagesDirectory, 'avatar.png');
        
        await sharp(sourceFilePath).resize({width: 48}).resize(48, 48).png({ compressionLevel: 9 }).toFile(iconDestinationFilePath);
        await sharp(sourceFilePath).resize({width: 128}).resize(128, 128).png({ compressionLevel: 9 }).toFile(avatarDestinationFilePath);
            
        const response = await node_setAvatar(jwtToken, iconDestinationFilePath, avatarDestinationFilePath);

        fs.unlinkSync(sourceFilePath);
        fs.unlinkSync(iconDestinationFilePath);
        fs.unlinkSync(avatarDestinationFilePath);

        clearNodeSettingsClientCache();

        result = response;
    }
    else {
        result = {isError: true, message: 'avatar file is missing'};
    }

    return result;
}

async function nodeBanner_GET() {
    const response = await node_getBanner();

    return response;
}

async function nodeBanner_POST(jwtToken, bannerFile) {
    let result;

    if(bannerFile != null && bannerFile.length === 1) {
        bannerFile = bannerFile[0];

        const imagesDirectory = getImagesDirectoryPath();
    
        const sourceFilePath = path.join(imagesDirectory, bannerFile.filename);
        
        const bannerDestinationFilePath = path.join(imagesDirectory, 'banner.png');
        
        await sharp(sourceFilePath).resize({width: 2560}).resize(2560, 424).png({ compressionLevel: 9 }).toFile(bannerDestinationFilePath);

        const response = await node_setBanner(jwtToken, bannerDestinationFilePath);
        
        fs.unlinkSync(sourceFilePath);
        fs.unlinkSync(bannerDestinationFilePath);

        clearNodeSettingsClientCache();
        
        result = response;
    }
    else {
        result = {isError: true, message: 'banner file is missing'};
    }

    return result;
}

async function nodePersonalizeNodeName_POST(jwtToken, nodeName) {
    const response = await node_setNodeName(jwtToken, nodeName);

    clearNodeSettingsClientCache();

    return response;
}

async function nodePersonalizeNodeAbout_POST(jwtToken, nodeAbout) {
    const response = await node_setNodeAbout(jwtToken, nodeAbout);

    clearNodeSettingsClientCache();

    return response;
}

async function nodePersonalizeNodeId_POST(jwtToken, nodeId) {
    const response = await node_setNodeId(jwtToken, nodeId);

    clearNodeSettingsClientCache();

    return response;
}

async function node_Secure_POST(jwtToken, isSecure, keyFile, certFile, caFiles) {
    let result;

    if(isSecure) {
        if(keyFile != null && keyFile.length === 1 && certFile != null && certFile.length === 1) {
            keyFile = keyFile[0];
            certFile = certFile[0];
            
            const response = await node_setSecureConnection(jwtToken, isSecure, keyFile, certFile, caFiles);

            if(!response.isError) {
                setMoarTubeNodeHttpProtocol('https');
                setMoarTubeNodeWebsocketProtocol('wss');

                clearNodeSettingsClientCache();
            }

            result = response;
        }
        else {
            result = {isError: true, message: 'invalid parameters'};
        }
    }
    else {
        const response = await node_setSecureConnection(jwtToken, isSecure, null, null, null);

        if(!response.isError) {
            setMoarTubeNodeHttpProtocol('http');
            setMoarTubeNodeWebsocketProtocol('ws');

            clearNodeSettingsClientCache();
        }

        result = response;
    }

    return result;
}

async function nodeNetworkInternal_POST(jwtToken, nodeListeningPort) {
    const response = await node_setNetworkInternal(jwtToken, nodeListeningPort);

    if(!response.isError) {
        setMoarTubeNodePort(nodeListeningPort);

        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeNetworkExternal_POST(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort) {
    const response = await node_setExternalNetwork(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort);

    if(!response.isError) {
        clearExternalVideosBaseUrlClientCache();
        clearNodeSettingsClientCache();

        const nodeSettings = await getNodeSettings(jwtToken);

        if(nodeSettings.storageConfig.storageMode === 's3provider') {
            const videosData = await node_getVideoDataOutputs(jwtToken);
            const externalVideosBaseUrl = await getExternalVideosBaseUrl(jwtToken);

            await s3_updateM3u8ManifestsWithExternalVideosBaseUrl(nodeSettings.storageConfig.s3Config, videosData, externalVideosBaseUrl);
        }
    }

    return response;
}

async function nodeCloudflareConfigure_POST(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey) {
    const response = await node_setCloudflareConfiguration(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeCloudflareTurnstileConfigure_POST(jwtToken, cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey) {
    const response = await node_setCloudflareTurnstileConfiguration(jwtToken, cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeCloudflareTurnstileClear_POST(jwtToken) {
    const response = await node_CloudflareTurnstileConfigurationClear(jwtToken);
    
    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeCloudflareClear_POST(jwtToken) {
    const response = await node_clearCloudflareConfiguration(jwtToken);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeDatabaseConfigToggle_POST(jwtToken, databaseConfig) {
    const response = await node_databaseConfigToggle(jwtToken, databaseConfig);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeDatabaseConfigEmpty_POST(jwtToken) {
    const response = await node_databaseConfigEmpty(jwtToken);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeStorageConfigToggle_POST(jwtToken, storageConfig, dnsConfig) {
    if(storageConfig.storageMode === 's3provider') {
        await s3_validateS3Config(JSON.parse(JSON.stringify(storageConfig.s3Config)));
    }

    const response = await node_storageConfigToggle(jwtToken, storageConfig, dnsConfig);

    if(!response.isError) {
        clearExternalVideosBaseUrlClientCache();
        clearNodeSettingsClientCache();
        
        const nodeSettings = await getNodeSettings(jwtToken);

        if(nodeSettings.storageConfig.storageMode === 's3provider') {
            const videosData = await node_getVideoDataOutputs(jwtToken);
            const externalVideosBaseUrl = await getExternalVideosBaseUrl(jwtToken);

            await s3_updateM3u8ManifestsWithExternalVideosBaseUrl(nodeSettings.storageConfig.s3Config, videosData, externalVideosBaseUrl);
        }
    }

    return response;
}

async function nodeStorageConfigEmpty_POST(jwtToken) {
    const response = await node_storageConfigEmpty(jwtToken);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeCommentsToggle_POST(jwtToken, isCommentsEnabled) {
    const response = await node_commentsToggle(jwtToken, isCommentsEnabled);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeLikesToggle_POST(jwtToken, isLikesEnabled) {
    const response = await node_likesToggle(jwtToken, isLikesEnabled);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeDislikesToggle_POST(jwtToken, isDislikesEnabled) {
    const response = await node_dislikesToggle(jwtToken, isDislikesEnabled);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeReportsToggle_POST(jwtToken, isReportsEnabled) {
    const response = await node_reportsToggle(jwtToken, isReportsEnabled);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeLiveChatToggle_POST(jwtToken, isLiveChatEnabled) {
    const response = await node_liveChatToggle(jwtToken, isLiveChatEnabled);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

async function nodeAccount_POST(jwtToken, username, password) {
    const response = await node_setAccountCredentials(jwtToken, username, password);

    if(!response.isError) {
        clearNodeSettingsClientCache();
    }

    return response;
}

module.exports = {
    client_GET,
    node_GET,
    clientGpuAcceleration_POST,
    clientEncodingDefault_GET,
    clientEncoding_POST,
    nodeAvatar_GET,
    nodeAvatar_POST,
    nodeBanner_GET,
    nodeBanner_POST,
    nodePersonalizeNodeName_POST,
    nodePersonalizeNodeAbout_POST,
    nodePersonalizeNodeId_POST,
    node_Secure_POST,
    nodeNetworkInternal_POST,
    nodeNetworkExternal_POST,
    nodeCloudflareConfigure_POST,
    nodeCloudflareTurnstileConfigure_POST,
    nodeCloudflareTurnstileClear_POST,
    nodeCloudflareClear_POST,
    nodeCommentsToggle_POST,
    nodeLikesToggle_POST,
    nodeDislikesToggle_POST,
    nodeReportsToggle_POST,
    nodeLiveChatToggle_POST,
    nodeAccount_POST,
    nodeDatabaseConfigToggle_POST,
    nodeDatabaseConfigEmpty_POST,
    nodeStorageConfigToggle_POST,
    nodeStorageConfigEmpty_POST
};