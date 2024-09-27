const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const multer = require('multer');
const packageJson = require('../package.json');

sharp.cache(false);

const { 
    logDebugMessageToConsole, getPublicDirectoryPath, getAppDataCertificatesDirectoryPath, setMoarTubeNodeHttpProtocol, setMoarTubeNodeWebsocketProtocol,
    setMoarTubeNodePort, detectOperatingSystem, detectSystemGpu, detectSystemCpu, getClientSettings, setClientSettings, getAppDataImagesDirectoryPath,
    getClientSettingsDefault
} = require('../utils/helpers');
const { 
    node_isAuthenticated, node_setExternalNetwork, node_getSettings, node_doSignout, node_getAvatar, node_setAvatar, 
    node_getBanner, node_setBanner, node_setNodeName, node_setNodeAbout, node_setNodeId, node_setSecureConnection, node_setNetworkInternal, node_setAccountCredentials,
    node_setCloudflareConfiguration, node_clearCloudflareConfiguration, node_setCloudflareTurnstileConfiguration, node_CloudflareTurnstileConfigurationClear
} = require('../utils/node-communications');

function root_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/settings.html');
                const fileStream = fs.createReadStream(pagePath);
                res.setHeader('Content-Type', 'text/html');
                fileStream.pipe(res);
            }
            else {
                res.redirect('/account/signin');
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        node_doSignout(req, res);
    });
}

function client_GET(req, res) {
    node_isAuthenticated(req.session.jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
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

                res.send({isError: false, clientSettings: settings});
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function node_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getSettings(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false, nodeSettings: nodeResponseData.nodeSettings});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function clientGpuAcceleration_POST(req, res) {
    node_isAuthenticated(req.session.jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const isGpuAccelerationEnabled = req.body.isGpuAccelerationEnabled;
                
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
                    
                            res.send({isError: false, result: result });
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
                    
                            res.send({isError: false, result: result });
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        });
                    }
                }
                else {
                    res.send({isError: true, message: 'this version of MoarTube Client only supports GPU acceleration on Windows platforms'});
                }
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function clientEncodingDefault_GET(req, res) {
    node_isAuthenticated(req.session.jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const clientSettingsDefault = getClientSettingsDefault();

                const videoEncoderSettings = clientSettingsDefault.videoEncoderSettings;
                const liveEncoderSettings = clientSettingsDefault.liveEncoderSettings;

                res.send({isError: false, videoEncoderSettings: videoEncoderSettings, liveEncoderSettings: liveEncoderSettings});
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function clientEncoding_POST(req, res) {
    node_isAuthenticated(req.session.jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoEncoderSettings = req.body.videoEncoderSettings;
                const liveEncoderSettings = req.body.liveEncoderSettings;

                const clientSettings = getClientSettings();

                clientSettings.videoEncoderSettings = videoEncoderSettings;
                clientSettings.liveEncoderSettings = liveEncoderSettings;

                setClientSettings(clientSettings);

                res.send({isError: false});
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function nodeAvatar_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.end();
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getAvatar(jwtToken)
                .then(nodeResponseData => {
                    res.setHeader('Content-Type', 'image/jpeg');
                    nodeResponseData.pipe(res);
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.end();
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.end();
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.end();
    });
}

function nodeAvatar_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                multer({
                    storage: multer.diskStorage({
                        destination: function (req, file, cb) {
                            const filePath = getAppDataImagesDirectoryPath();
                            
                            fs.access(filePath, fs.constants.F_OK, function(error) {
                                if(error) {
                                    cb(new Error('file upload error'), null);
                                }
                                else {
                                    cb(null, filePath);
                                }
                            });
                        },
                        filename: function (req, file, cb) {
                            let extension;
                            
                            if(file.mimetype === 'image/png') {
                                extension = '.png';
                            }
                            else if(file.mimetype === 'image/jpeg') {
                                extension = '.jpg';
                            }
                            
                            const fileName = Date.now() + extension;
                            
                            cb(null, fileName);
                        }
                    })
                }).fields([{ name: 'avatar_file', maxCount: 1 }])
                (req, res, function(error) {
                    if(error) {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    }
                    else {
                        const avatarFile = req.files['avatar_file'][0];
                        
                        const imagesDirectory = getAppDataImagesDirectoryPath();
                    
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
                                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                        
                                        res.send({isError: true, message: nodeResponseData.message});
                                    }
                                    else {
                                        logDebugMessageToConsole('uploaded avatar to node', null, null, true);
                                        
                                        fs.unlinkSync(sourceFilePath);
                                        fs.unlinkSync(iconDestinationFilePath);
                                        fs.unlinkSync(avatarDestinationFilePath);
                                        
                                        res.send({isError: false});
                                    }
                                })
                                .catch(error => {
                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                    
                                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                });
                            })
                            .catch(error => {
                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                
                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                            });
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        });
                    }
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    });
}

function nodeBanner_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.end();
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getBanner(jwtToken)
                .then(nodeResponseData => {
                    res.setHeader('Content-Type', 'image/jpeg');
                    nodeResponseData.pipe(res);
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.end();
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.end();
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.end();
    });
}

function nodeBanner_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                multer({
                    storage: multer.diskStorage({
                        destination: function (req, file, cb) {
                            const filePath = getAppDataImagesDirectoryPath();
                            
                            fs.access(filePath, fs.constants.F_OK, function(error) {
                                if(error) {
                                    cb(new Error('file upload error'), null);
                                }
                                else {
                                    cb(null, filePath);
                                }
                            });
                        },
                        filename: function (req, file, cb) {
                            let extension;
                            
                            if(file.mimetype === 'image/png') {
                                extension = '.png';
                            }
                            else if(file.mimetype === 'image/jpeg') {
                                extension = '.jpg';
                            }
                            
                            const fileName = Date.now() + extension;
                            
                            cb(null, fileName);
                        }
                    })
                }).fields([{ name: 'banner_file', maxCount: 1 }])
                (req, res, function(error) {
                    if(error) {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    }
                    else {
                        const bannerFile = req.files['banner_file'][0];
                        
                        const imagesDirectory = getAppDataImagesDirectoryPath();
                    
                        const sourceFilePath = path.join(imagesDirectory, bannerFile.filename);
                        
                        const bannerDestinationFilePath = path.join(imagesDirectory, 'banner.png');
                        
                        sharp(sourceFilePath).resize({width: 2560}).resize(2560, 424).png({ compressionLevel: 9 }).toFile(bannerDestinationFilePath)
                        .then(() => {
                            fs.unlinkSync(sourceFilePath);
                            
                            node_setBanner(jwtToken, bannerDestinationFilePath)
                            .then(nodeResponseData => {
                                if(nodeResponseData.isError) {
                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                    
                                    res.send({isError: true, message: nodeResponseData.message});
                                }
                                else {
                                    logDebugMessageToConsole('uploaded avatar to node', null, null, true);
                                    
                                    fs.unlinkSync(bannerDestinationFilePath);
                                    
                                    res.send({isError: false});
                                }
                            })
                            .catch(error => {
                                logDebugMessageToConsole(null, error, new Error().stack, true);
                                
                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                            });
                            
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        });
                    }
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    });
}

function nodePersonalizeNodeName_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                let nodeName = req.body.nodeName;
                
                node_setNodeName(jwtToken, nodeName)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    });
}

function nodePersonalizeNodeAbout_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                let nodeAbout = req.body.nodeAbout;
                
                node_setNodeAbout(jwtToken, nodeAbout)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    });
}

function nodePersonalizeNodeId_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                let nodeId = req.body.nodeId;
                
                node_setNodeId(jwtToken, nodeId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    });
}

function node_Secure_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                let isSecure = req.query.isSecure;
                
                isSecure = (isSecure === 'true');
                
                if(isSecure) {
                    multer({
                        fileFilter: function (req, file, cb) {
                            cb(null, true);
                        },
                        storage: multer.diskStorage({
                            destination: function (req, file, cb) {
                                fs.access(getAppDataCertificatesDirectoryPath(), fs.constants.F_OK, function(error) {
                                    if(error) {
                                        cb(new Error('file upload error'), null);
                                    }
                                    else {
                                        cb(null, getAppDataCertificatesDirectoryPath());
                                    }
                                });
                            },
                            filename: function (req, file, cb) {
                                if(file.fieldname === 'keyFile') {
                                    cb(null, 'private_key.pem');
                                }
                                else if(file.fieldname === 'certFile') {
                                    cb(null, 'certificate.pem');
                                }
                                else if(file.fieldname === 'caFiles') {
                                    cb(null, file.originalname);
                                }
                                else {
                                    cb(new Error('invalid field name in POST /settings/node/secure:' + file.fieldname), null);
                                }
                            }
                        })
                    }).fields([{ name: 'keyFile', maxCount: 1 }, { name: 'certFile', maxCount: 1 }, { name: 'caFiles', maxCount: 10 }])
                    (req, res, function(error) {
                        if(error) {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        }
                        else {
                            let keyFile = req.files['keyFile'];
                            let certFile = req.files['certFile'];
                            const caFiles = req.files['caFiles'];
                            
                            if(keyFile == null || keyFile.length !== 1) {
                                res.send({isError: true, message: 'private key file is missing'});
                            }
                            else if(certFile == null || certFile.length !== 1) {
                                res.send({isError: true, message: 'cert file is missing'});
                            }
                            else {
                                keyFile = keyFile[0];
                                certFile = certFile[0];
                                
                                node_setSecureConnection(jwtToken, isSecure, keyFile, certFile, caFiles)
                                .then(nodeResponseData => {
                                    if(nodeResponseData.isError) {
                                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                        
                                        res.send({isError: true, message: nodeResponseData.message});
                                    }
                                    else {
                                        setMoarTubeNodeHttpProtocol('https');
                                        setMoarTubeNodeWebsocketProtocol('wss');
                                        
                                        res.send({isError: false});
                                    }
                                })
                                .catch(error => {
                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                    
                                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                });
                            }
                        }
                    });
                }
                else {
                    node_setSecureConnection(jwtToken, isSecure, null, null, null)
                    .then(nodeResponseData => {
                        if(nodeResponseData.isError) {
                            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                            
                            res.send({isError: true, message: nodeResponseData.message});
                        }
                        else {
                            setMoarTubeNodeHttpProtocol('http');
                            setMoarTubeNodeWebsocketProtocol('ws');
                            
                            res.send({isError: false});
                        }
                    })
                    .catch(error => {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    });
                }
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    });
}

function nodeNetworkInternal_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const nodeListeningPort = req.body.nodeListeningPort;
                
                node_setNetworkInternal(jwtToken, nodeListeningPort)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        setMoarTubeNodePort(nodeListeningPort);

                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function nodeNetworkExternal_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const publicNodeProtocol = req.body.publicNodeProtocol;
                const publicNodeAddress = req.body.publicNodeAddress;
                const publicNodePort = req.body.publicNodePort;

                node_setExternalNetwork(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function nodeCloudflareConfigure_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const cloudflareEmailAddress = req.body.cloudflareEmailAddress;
                const cloudflareZoneId = req.body.cloudflareZoneId;
                const cloudflareGlobalApiKey = req.body.cloudflareGlobalApiKey;

                node_setCloudflareConfiguration(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function nodeCloudflareTurnstileConfigure_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const cloudflareTurnstileSiteKey = req.body.cloudflareTurnstileSiteKey;
                const cloudflareTurnstileSecretKey = req.body.cloudflareTurnstileSecretKey;

                node_setCloudflareTurnstileConfiguration(jwtToken, cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function nodeCloudflareTurnstileClear_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) { 
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_CloudflareTurnstileConfigurationClear(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) { 
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    });
}

function nodeCloudflareClear_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) { 
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_clearCloudflareConfiguration(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) { 
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    });
}

function nodeAccount_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const username = req.body.username;
                const password = req.body.password;
                
                node_setAccountCredentials(jwtToken, username, password)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: nodeResponseData.message});
                    }
                    else {
                        res.send({isError: false});
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);
                
                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

module.exports = {
    root_GET,
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
    nodeAccount_POST
};