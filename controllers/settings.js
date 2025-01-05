const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const packageJson = require('../package.json');

sharp.cache(false);

const { 
    logDebugMessageToConsole, setMoarTubeNodeHttpProtocol, setMoarTubeNodeWebsocketProtocol, setMoarTubeNodePort, detectOperatingSystem, detectSystemGpu, 
    detectSystemCpu, getClientSettings, setClientSettings, getImagesDirectoryPath, getClientSettingsDefault
} = require('../utils/helpers');
const { 
    node_setExternalNetwork, node_getSettings, node_getAvatar, node_setAvatar, node_getBanner, node_setBanner, node_setNodeName, node_setNodeAbout, 
    node_setNodeId, node_setSecureConnection, node_setNetworkInternal, node_setAccountCredentials, node_setCloudflareConfiguration, 
    node_clearCloudflareConfiguration, node_setCloudflareTurnstileConfiguration, node_CloudflareTurnstileConfigurationClear,
    node_commentsToggle, node_likesToggle, node_dislikesToggle, node_reportsToggle, node_liveChatToggle, node_databaseConfigToggle
} = require('../utils/node-communications');

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

function node_GET(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_getSettings(jwtToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false, nodeSettings: nodeResponseData.nodeSettings});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function clientGpuAcceleration_POST(isGpuAccelerationEnabled) {
    return new Promise(function(resolve, reject) {
        const operatingSystem = detectOperatingSystem();
        
        if(operatingSystem === 'win32') {
            const clientSettings = getClientSettings();
            
            const result = {};
            
            if(isGpuAccelerationEnabled) {
                detectSystemGpu()
                .then((systemGpu) => {
                    clientSettings.processingAgent.processingAgentType = 'gpu';
                    clientSettings.processingAgent.processingAgentName = systemGpu.processingAgentName;
                    clientSettings.processingAgent.processingAgentModel = systemGpu.processingAgentModel;
                    
                    result.isGpuAccelerationEnabled = true;
                    result.gpuVendor = systemGpu.processingAgentName;
                    result.gpuModel = systemGpu.processingAgentModel;
                    
                    setClientSettings(clientSettings);
            
                    resolve({isError: false, result: result });
                })
                .catch(error => {
                    reject(error);
                });
            }
            else {
                detectSystemCpu()
                .then((systemCpu) => {
                    clientSettings.processingAgent.processingAgentType = 'cpu';
                    clientSettings.processingAgent.processingAgentName = systemCpu.processingAgentName;
                    clientSettings.processingAgent.processingAgentModel = systemCpu.processingAgentModel;
                    
                    result.isGpuAccelerationEnabled = false;

                    setClientSettings(clientSettings);
            
                    resolve({isError: false, result: result });
                })
                .catch(error => {
                    reject(error);
                });
            }
        }
        else {
            resolve({isError: true, message: 'this version of MoarTube Client only supports GPU acceleration on Windows platforms'});
        }
    });
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

function nodeAvatar_GET() {
    return new Promise(function(resolve, reject) {
        node_getAvatar()
        .then(nodeResponseData => {
            resolve(nodeResponseData);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeAvatar_POST(jwtToken, avatarFile) {
    return new Promise(function(resolve, reject) {
        if(avatarFile != null && avatarFile.length === 1) {
            avatarFile = avatarFile[0];

            const imagesDirectory = getImagesDirectoryPath();
            
            const sourceFilePath = path.join(imagesDirectory, avatarFile.filename);
            
            const iconDestinationFilePath = path.join(imagesDirectory, 'icon.png');
            const avatarDestinationFilePath = path.join(imagesDirectory, 'avatar.png');
            
            sharp(sourceFilePath).resize({width: 48}).resize(48, 48).png({ compressionLevel: 9 }).toFile(iconDestinationFilePath)
            .then(() => {
                sharp(sourceFilePath).resize({width: 128}).resize(128, 128).png({ compressionLevel: 9 }).toFile(avatarDestinationFilePath)
                .then(() => {
                    node_setAvatar(jwtToken, iconDestinationFilePath, avatarDestinationFilePath)
                    .then(nodeResponseData => {
                        if(nodeResponseData.isError) {
                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                            
                            resolve({isError: true, message: nodeResponseData.message});
                        }
                        else {
                            logDebugMessageToConsole('uploaded avatar to node', null, null);
                            
                            fs.unlinkSync(sourceFilePath);
                            fs.unlinkSync(iconDestinationFilePath);
                            fs.unlinkSync(avatarDestinationFilePath);
                            
                            resolve({isError: false});
                        }
                    })
                    .catch(error => {
                        reject(error);
                    });
                })
                .catch(error => {
                    reject(error);
                });
            })
            .catch(error => {
                reject(error);
            });
        }
        else {
            resolve({isError: true, message: 'avatar file is missing'});
        }
    });
}

function nodeBanner_GET() {
    return new Promise(function(resolve, reject) {
        node_getBanner()
        .then(nodeResponseData => {
            resolve(nodeResponseData);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeBanner_POST(jwtToken, bannerFile) {
    return new Promise(function(resolve, reject) {
        if(bannerFile != null && bannerFile.length === 1) {
            bannerFile = bannerFile[0];

            const imagesDirectory = getImagesDirectoryPath();
        
            const sourceFilePath = path.join(imagesDirectory, bannerFile.filename);
            
            const bannerDestinationFilePath = path.join(imagesDirectory, 'banner.png');
            
            sharp(sourceFilePath).resize({width: 2560}).resize(2560, 424).png({ compressionLevel: 9 }).toFile(bannerDestinationFilePath)
            .then(() => {
                fs.unlinkSync(sourceFilePath);
                
                node_setBanner(jwtToken, bannerDestinationFilePath)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        
                        resolve({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        logDebugMessageToConsole('uploaded avatar to node', null, null);
                        
                        fs.unlinkSync(bannerDestinationFilePath);
                        
                        resolve({isError: false});
                    }
                })
                .catch(error => {
                    reject(error);
                });
                
            })
            .catch(error => {
                reject(error);
            });
        }
        else {
            resolve({isError: true, message: 'banner file is missing'});
        }
    });
}

function nodePersonalizeNodeName_POST(jwtToken, nodeName) {
    return new Promise(function(resolve, reject) {
        node_setNodeName(jwtToken, nodeName)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodePersonalizeNodeAbout_POST(jwtToken, nodeAbout) {
    return new Promise(function(resolve, reject) {
        node_setNodeAbout(jwtToken, nodeAbout)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodePersonalizeNodeId_POST(jwtToken, nodeId) {
    return new Promise(function(resolve, reject) {
        node_setNodeId(jwtToken, nodeId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_Secure_POST(jwtToken, isSecure, keyFile, certFile, caFiles) {
    return new Promise(function(resolve, reject) {
        if(isSecure) {
            if(keyFile != null && keyFile.length === 1 && certFile != null && certFile.length === 1) {
                keyFile = keyFile[0];
                certFile = certFile[0];
                
                node_setSecureConnection(jwtToken, isSecure, keyFile, certFile, caFiles)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                        
                        resolve({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        setMoarTubeNodeHttpProtocol('https');
                        setMoarTubeNodeWebsocketProtocol('wss');
                        
                        resolve({isError: false});
                    }
                })
                .catch(error => {
                    reject(error);
                });
            }
            else {
                resolve({isError: true, message: 'invalid parameters'});
            }
        }
        else {
            node_setSecureConnection(jwtToken, isSecure, null, null, null)
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                    
                    resolve({isError: true, message: nodeResponseData.message});
                }
                else {
                    setMoarTubeNodeHttpProtocol('http');
                    setMoarTubeNodeWebsocketProtocol('ws');
                    
                    resolve({isError: false});
                }
            })
            .catch(error => {
                reject(error);
            });
        }
    });
}

function nodeNetworkInternal_POST(jwtToken, nodeListeningPort) {
    return new Promise(function(resolve, reject) {
        node_setNetworkInternal(jwtToken, nodeListeningPort)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                setMoarTubeNodePort(nodeListeningPort);

                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeNetworkExternal_POST(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort) {
    return new Promise(function(resolve, reject) {
        node_setExternalNetwork(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeCloudflareConfigure_POST(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey) {
    return new Promise(function(resolve, reject) {
        node_setCloudflareConfiguration(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeCloudflareTurnstileConfigure_POST(jwtToken, cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey) {
    return new Promise(function(resolve, reject) {
        node_setCloudflareTurnstileConfiguration(jwtToken, cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeCloudflareTurnstileClear_POST(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_CloudflareTurnstileConfigurationClear(jwtToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) { 
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeCloudflareClear_POST(jwtToken) {
    return new Promise(function(resolve, reject) {
        node_clearCloudflareConfiguration(jwtToken)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) { 
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeDatabaseConfigToggle_POST(jwtToken, databaseConfig) {
    return new Promise(function(resolve, reject) {
        node_databaseConfigToggle(jwtToken, databaseConfig)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) { 
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeCommentsToggle_POST(jwtToken, isCommentsEnabled) {
    return new Promise(function(resolve, reject) {
        node_commentsToggle(jwtToken, isCommentsEnabled)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeLikesToggle_POST(jwtToken, isLikesEnabled) {
    return new Promise(function(resolve, reject) {
        node_likesToggle(jwtToken, isLikesEnabled)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeDislikesToggle_POST(jwtToken, isDislikesEnabled) {
    return new Promise(function(resolve, reject) {
        node_dislikesToggle(jwtToken, isDislikesEnabled)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeReportsToggle_POST(jwtToken, isReportsEnabled) {
    return new Promise(function(resolve, reject) {
        node_reportsToggle(jwtToken, isReportsEnabled)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeLiveChatToggle_POST(jwtToken, isLiveChatEnabled) {
    return new Promise(function(resolve, reject) {
        node_liveChatToggle(jwtToken, isLiveChatEnabled)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function nodeAccount_POST(jwtToken, username, password) {
    return new Promise(function(resolve, reject) {
        node_setAccountCredentials(jwtToken, username, password)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            reject(error);
        });
    });
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
    nodeDatabaseConfigToggle_POST
};