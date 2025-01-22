const express = require('express');
const fs = require('fs');
const multer = require('multer');

const { 
    client_GET, node_GET, clientGpuAcceleration_POST, clientEncoding_POST, nodeAvatar_GET, nodeAvatar_POST, nodeBanner_GET, nodeBanner_POST,
    nodePersonalizeNodeName_POST, nodePersonalizeNodeAbout_POST, nodePersonalizeNodeId_POST, node_Secure_POST, nodeNetworkInternal_POST, nodeNetworkExternal_POST, nodeAccount_POST,
    nodeCloudflareConfigure_POST, nodeCloudflareClear_POST, nodeCloudflareTurnstileConfigure_POST, nodeCloudflareTurnstileClear_POST, clientEncodingDefault_GET,
    nodeCommentsToggle_POST, nodeDislikesToggle_POST, nodeLikesToggle_POST, nodeReportsToggle_POST, nodeLiveChatToggle_POST, nodeDatabaseConfigToggle_POST, nodeDatabaseConfigEmpty_POST,
    nodeStorageConfigToggle_POST, nodeStorageConfigEmpty_POST
 } = require('../controllers/settings');
 const { logDebugMessageToConsole, getCertificatesDirectoryPath, getImagesDirectoryPath } = require('../utils/helpers');
const { node_isAuthenticated, node_doSignout } = require('../utils/node-communications');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const response = await node_isAuthenticated(jwtToken);

        if (response.isError) {
            logDebugMessageToConsole(response.message, null, new Error().stack);

            node_doSignout(req, res);
        }
        else if (response.isAuthenticated) {
            res.render('settings', {});
        }
        else {
            res.redirect('/account/signin');
        }
    }
    catch (error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        node_doSignout(req, res);
    }
});

router.get('/client', (req, res) => {
    try {
        const data = client_GET();

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/client/gpuAcceleration', async (req, res) => {
    try {
        const isGpuAccelerationEnabled = req.body.isGpuAccelerationEnabled;

        const data = await clientGpuAcceleration_POST(isGpuAccelerationEnabled);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.get('/client/encoding/default', (req, res) => {
    try {
        const data = clientEncodingDefault_GET();

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/client/encoding', (req, res) => {
    try {
        const videoEncoderSettings = req.body.videoEncoderSettings;
        const liveEncoderSettings = req.body.liveEncoderSettings;
        
        const data = clientEncoding_POST(videoEncoderSettings, liveEncoderSettings);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.get('/node', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const nodeSettings = await node_GET(jwtToken);

        res.send({nodeSettings: nodeSettings});
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.get('/node/avatar', async (req, res) => {
    try {
        const data = await nodeAvatar_GET(req, res);

        res.setHeader('Content-Type', 'image/jpeg');

        data.pipe(res);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/avatar', (req, res) => {
    const jwtToken = req.session.jwtToken;

    multer({
        storage: multer.diskStorage({
            destination: function (req, file, cb) {
                const filePath = getImagesDirectoryPath();
                
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
    (req, res, async function(error) {
        if(error) {
            logDebugMessageToConsole(null, error, new Error().stack);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            try {
                const avatarFile = req.files['avatar_file'];

                const data = await nodeAvatar_POST(jwtToken, avatarFile);

                res.send(data);
            }
            catch(error) {
                logDebugMessageToConsole(null, error, new Error().stack);
            
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            }
        }
    });
});

router.get('/node/banner', async (req, res) => {
    try {
        const data = await nodeBanner_GET();

        res.setHeader('Content-Type', 'image/jpeg');

        data.pipe(res);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/banner', (req, res) => {
    const jwtToken = req.session.jwtToken;

    multer({
        storage: multer.diskStorage({
            destination: function (req, file, cb) {
                const filePath = getImagesDirectoryPath();
                
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
    (req, res, async function(error) {
        if(error) {
            logDebugMessageToConsole(null, error, new Error().stack);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            try {
                const bannerFile = req.files['banner_file'];

                const data = await nodeBanner_POST(jwtToken, bannerFile);

                res.send(data);
            }
            catch(error) {
                logDebugMessageToConsole(null, error, new Error().stack);
            
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            }
        }
    });
});

router.post('/node/personalize/nodeName', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const nodeName = req.body.nodeName;

        const data = await nodePersonalizeNodeName_POST(jwtToken, nodeName);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/personalize/nodeAbout', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const nodeAbout = req.body.nodeAbout;

        const data = await nodePersonalizeNodeAbout_POST(jwtToken, nodeAbout);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/personalize/nodeId', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const nodeId = req.body.nodeId;

        const data = await nodePersonalizeNodeId_POST(jwtToken, nodeId);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/secure', async (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    const isSecure = (req.query.isSecure === 'true');

    if(isSecure) {
        multer({
            fileFilter: function (req, file, cb) {
                cb(null, true);
            },
            storage: multer.diskStorage({
                destination: function (req, file, cb) {
                    fs.access(getCertificatesDirectoryPath(), fs.constants.F_OK, function(error) {
                        if(error) {
                            cb(new Error('file upload error'), null);
                        }
                        else {
                            cb(null, getCertificatesDirectoryPath());
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
        (req, res, async function(error) {
            if(error) {
                logDebugMessageToConsole(null, error, new Error().stack);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            }
            else {
                try {
                    const keyFile = req.files['keyFile'];
                    const certFile = req.files['certFile'];
                    const caFiles = req.files['caFiles'];
                    
                    const data = await node_Secure_POST(jwtToken, isSecure, keyFile, certFile, caFiles);

                    res.send(data);
                }
                catch(error) {
                    logDebugMessageToConsole(null, error, new Error().stack);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                }
            }
        });
    }
    else {
        try {
            const data = await node_Secure_POST(jwtToken, isSecure);

            res.send(data);
        }
        catch(error) {
            logDebugMessageToConsole(null, error, new Error().stack);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
    }
});

router.post('/node/network/internal', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
    
        const nodeListeningPort = req.body.nodeListeningPort;

        const data = await nodeNetworkInternal_POST(jwtToken, nodeListeningPort);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/network/external', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const publicNodeProtocol = req.body.publicNodeProtocol;
        const publicNodeAddress = req.body.publicNodeAddress;
        const publicNodePort = req.body.publicNodePort;

        const data = await nodeNetworkExternal_POST(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/cloudflare/configure', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const cloudflareEmailAddress = req.body.cloudflareEmailAddress;
        const cloudflareZoneId = req.body.cloudflareZoneId;
        const cloudflareGlobalApiKey = req.body.cloudflareGlobalApiKey;

        const data = await nodeCloudflareConfigure_POST(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/cloudflare/turnstile/configure', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        
        const cloudflareTurnstileSiteKey = req.body.cloudflareTurnstileSiteKey;
        const cloudflareTurnstileSecretKey = req.body.cloudflareTurnstileSecretKey;

        const data = await nodeCloudflareTurnstileConfigure_POST(jwtToken, cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/cloudflare/turnstile/clear', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await nodeCloudflareTurnstileClear_POST(jwtToken);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/cloudflare/clear', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await nodeCloudflareClear_POST(jwtToken);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/databaseConfig/toggle', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const databaseConfig = req.body.databaseConfig;

        const data = await nodeDatabaseConfigToggle_POST(jwtToken, databaseConfig);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/databaseConfig/empty', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const data = await nodeDatabaseConfigEmpty_POST(jwtToken);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/storageConfig/toggle', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const storageConfig = req.body.storageConfig;
        const dnsConfig = req.body.dnsConfig;

        let data = await nodeStorageConfigToggle_POST(jwtToken, storageConfig, dnsConfig);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/storageConfig/empty', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        let data = await nodeStorageConfigEmpty_POST(jwtToken);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/comments/toggle', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        const isCommentsEnabled = req.body.isCommentsEnabled;

        const data = await nodeCommentsToggle_POST(jwtToken, isCommentsEnabled);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/likes/toggle', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        const isLikesEnabled = req.body.isLikesEnabled;

        const data = await nodeLikesToggle_POST(jwtToken, isLikesEnabled);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/dislikes/toggle', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        const isDislikesEnabled = req.body.isDislikesEnabled;

        const data = await nodeDislikesToggle_POST(jwtToken, isDislikesEnabled);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/reports/toggle', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        const isReportsEnabled = req.body.isReportsEnabled;

        const data = await nodeReportsToggle_POST(jwtToken, isReportsEnabled);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/liveChat/toggle', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
        const isLiveChatEnabled = req.body.isLiveChatEnabled;

        const data = await nodeLiveChatToggle_POST(jwtToken, isLiveChatEnabled);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.post('/node/account', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;
    
        const username = req.body.username;
        const password = req.body.password;

        const data = await nodeAccount_POST(jwtToken, username, password);

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);
    
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

module.exports = router;