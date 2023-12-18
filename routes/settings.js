const express = require('express');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const multer = require('multer');

sharp.cache(false);

const { 
    logDebugMessageToConsole, getPublicDirectoryPath, getTempCertificatesDirectoryPath, setMoarTubeNodeHttpProtocol, setMoarTubeNodeWebsocketProtocol,
    setMoarTubeNodePort, detectOperatingSystem, detectSystemGpu, detectSystemCpu, getClientSettings, setClientSettings
} = require('../utils/helpers');
const { 
    node_isAuthenticated, node_setPrivate, node_setExternalNetwork, node_getSettings, node_doSignout, node_getAvatar, node_setAvatar, 
    node_getBanner, node_setBanner, node_setNodeName, node_setSecureConnection, node_setNetworkInternal, node_setAccountCredentials
} = require('../utils/node-communications');

const router = express.Router();

router.get('/', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getSettings(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        node_doSignout(req, res);
                    }
                    else {
                        const nodeSettings = nodeResponseData.nodeSettings;
                        
                        if(nodeSettings.isNodeConfigured) {
                            const pagePath = path.join(getPublicDirectoryPath(), 'pages/settings.html');
                            const fileStream = fs.createReadStream(pagePath);
                            res.setHeader('Content-Type', 'text/html');
                            fileStream.pipe(res);
                        }
                        else {
                            res.redirect('/configure');
                        }
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    node_doSignout(req, res);
                });
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
});

router.get('/client', (req, res) => {
    node_isAuthenticated(req.session.jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const settings = {
                    isGpuAccelerationEnabled: false
                };
                
                const clientSettings = getClientSettings();
                
                if(clientSettings.processingAgent.processingAgentType === 'gpu') {
                    settings.isGpuAccelerationEnabled = true;
                    settings.gpuVendor = clientSettings.processingAgent.processingAgentName;
                    settings.gpuModel = clientSettings.processingAgent.processingAgentModel;
                }
                
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
});

router.get('/node', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getSettings(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
});

router.post('/client/gpuAcceleration', (req, res) => {
    node_isAuthenticated(req.session.jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
});

router.get('/node/avatar', (req, res) => {
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
});

router.post('/node/avatar', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                multer({
                    storage: multer.diskStorage({
                        destination: function (req, file, cb) {
                            const filePath = path.join(getPublicDirectoryPath(), 'images');
                            
                            fs.access(filePath, fs.F_OK, function(error) {
                                if(error) {
                                    cb(new Error('file upload error'));
                                }
                                else {
                                    cb(null, filePath);
                                }
                            });
                        },
                        filename: function (req, file, cb) {
                            var extension;
                            
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
                }).fields([{ name: 'avatar_file', minCount: 1, maxCount: 1 }])
                (req, res, function(error) {
                    if(error) {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    }
                    else {
                        const avatarFile = req.files['avatar_file'][0];
                        
                        const imagesDirectory = path.join(getPublicDirectoryPath(), 'images');
                    
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
                                        
                                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
});

router.get('/node/banner', (req, res) => {
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
});

router.post('/node/banner', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                multer({
                    storage: multer.diskStorage({
                        destination: function (req, file, cb) {
                            const filePath = path.join(getPublicDirectoryPath(), 'images');
                            
                            fs.access(filePath, fs.F_OK, function(error) {
                                if(error) {
                                    cb(new Error('file upload error'));
                                }
                                else {
                                    cb(null, filePath);
                                }
                            });
                        },
                        filename: function (req, file, cb) {
                            var extension;
                            
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
                }).fields([{ name: 'banner_file', minCount: 1, maxCount: 1 }])
                (req, res, function(error) {
                    if(error) {
                        logDebugMessageToConsole(null, error, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    }
                    else {
                        const bannerFile = req.files['banner_file'][0];
                        
                        const imagesDirectory = path.join(getPublicDirectoryPath(), 'images');
                    
                        const sourceFilePath = path.join(imagesDirectory, bannerFile.filename);
                        
                        const bannerDestinationFilePath = path.join(imagesDirectory, 'banner.png');
                        
                        sharp(sourceFilePath).resize({width: 2560}).resize(2560, 424).png({ compressionLevel: 9 }).toFile(bannerDestinationFilePath)
                        .then(() => {
                            fs.unlinkSync(sourceFilePath);
                            
                            node_setBanner(jwtToken, bannerDestinationFilePath)
                            .then(nodeResponseData => {
                                if(nodeResponseData.isError) {
                                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                    
                                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
});

router.post('/node/personalize', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                var nodeName = req.body.nodeName;
                var nodeAbout = req.body.nodeAbout;
                var nodeId = req.body.nodeId;
                
                node_setNodeName(jwtToken, nodeName, nodeAbout, nodeId)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
});

router.post('/node/secure', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                var isSecure = req.query.isSecure;
                
                isSecure = (isSecure === 'true');
                
                if(isSecure) {
                    multer({
                        fileFilter: function (req, file, cb) {
                            cb(null, true);
                        },
                        storage: multer.diskStorage({
                            destination: function (req, file, cb) {
                                fs.access(getTempCertificatesDirectoryPath(), fs.F_OK, function(error) {
                                    if(error) {
                                        cb(new Error('file upload error'));
                                    }
                                    else {
                                        cb(null, getTempCertificatesDirectoryPath());
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
                                    cb(new Error('invalid field name in POST /settings/node/secure:' + file.fieldname));
                                }
                            }
                        })
                    }).fields([{ name: 'keyFile', minCount: 1, maxCount: 1 }, { name: 'certFile', minCount: 1, maxCount: 1 }, { name: 'caFiles', minCount: 0 }])
                    (req, res, function(error) {
                        if(error) {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        }
                        else {
                            var keyFile = req.files['keyFile'];
                            var certFile = req.files['certFile'];
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
});

router.post('/node/private', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const isNodePrivate = req.body.isNodePrivate;
                
                node_setPrivate(jwtToken, isNodePrivate)
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
});

router.post('/node/network/internal', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
});

router.post('/node/network/external', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
});

router.post('/node/account', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const username = req.body.username;
                const password = req.body.password;
                
                node_setAccountCredentials(jwtToken, username, password)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
});

module.exports = router;