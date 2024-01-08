const webSocket = require('ws');
const path = require('path');
const fs = require('fs');

const { 
    logDebugMessageToConsole, getMoarTubeNodeWebsocketUrl, getPublicDirectoryPath, setMoarTubeNodeHttpProtocol, setMoarTubeNodeWebsocketProtocol, setMoarTubeNodeIp, 
    setMoarTubeNodePort, setWebsocketClient, websocketServerBroadcast
} = require('../utils/helpers');
const { isPublicNodeAddressValid, isPortValid } = require('../utils/validators');
const { node_isAuthenticated, node_doHeartBeat, node_doSignin, node_doSignout, node_getSettings } = require('../utils/node-communications');
const { stoppingVideoImport, stoppedVideoImport } = require('../utils/trackers/import-video-tracker');
const { stoppingLiveStream, stoppedLiveStream } = require('../utils/trackers/live-stream-tracker');
const { stoppingPublishVideoEncoding, stoppedPublishVideoEncoding } = require('../utils/trackers/publish-video-encoding-tracker');

function signIn_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send('error communicating with the MoarTube node');
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getSettings(jwtToken)
                .then(nodeResponseData => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send('error communicating with the MoarTube node');
                    }
                    else {
                        const nodeSettings = nodeResponseData.nodeSettings;
                        
                        if(nodeSettings.isNodeConfigured) {
                            res.redirect('/videos');
                        }
                        else {
                            res.redirect('/configure');
                        }
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send('error communicating with the MoarTube node');
                });
            }
            else {
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/signin.html');
                const fileStream = fs.createReadStream(pagePath);
                res.setHeader('Content-Type', 'text/html');
                fileStream.pipe(res);
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send('error communicating with the MoarTube node');
    });
}

function signIn_POST(req, res) {
    const username = req.body.username;
    const password = req.body.password;
    const moarTubeNodeIp = req.body.moarTubeNodeIp;
    const moarTubeNodePort = req.body.moarTubeNodePort;
    const rememberMe = req.body.rememberMe;
    
    if(!isPublicNodeAddressValid(moarTubeNodeIp)) {
        logDebugMessageToConsole('attempted to sign in with invalid ip address or domian name: ' + moarTubeNodeIp, null, null, true);
        
        res.send({isError: true, message: 'ip address or domain name is not valid'});
    }
    else if(!isPortValid(moarTubeNodePort)) {
        logDebugMessageToConsole('attempted to sign in with invalid port: ' + moarTubeNodePort, null, null, true);
        
        res.send({isError: true, message: 'port is not valid'});
    }
    else {
        logDebugMessageToConsole('attempting user sign in with HTTP...', null, null, true);
        
        node_doHeartBeat('http', moarTubeNodeIp, moarTubeNodePort)
        .then((nodeResponseData) => {
            logDebugMessageToConsole('user signing in with HTTP available', null, null, true);
            
            performSignIn('http', 'ws', moarTubeNodeIp, moarTubeNodePort);
        })
        .catch(error => {
            logDebugMessageToConsole('attempting user sign in with HTTPS...', null, null, true);
            
            node_doHeartBeat('https', moarTubeNodeIp, moarTubeNodePort)
            .then((nodeResponseData) => {
                logDebugMessageToConsole('user signing in with HTTPS available', null, null, true);
                
                performSignIn('https', 'wss', moarTubeNodeIp, moarTubeNodePort);
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            });
        });
        
        function performSignIn(moarTubeNodeProtocol, moarTubeNodeWebsocketProtocol, moarTubeNodeIp, moarTubeNodePort) {
            setMoarTubeNodeHttpProtocol(moarTubeNodeProtocol);
            setMoarTubeNodeWebsocketProtocol(moarTubeNodeWebsocketProtocol);

            setMoarTubeNodeIp(moarTubeNodeIp);
            setMoarTubeNodePort(moarTubeNodePort);
            
            node_doSignin(username, password, rememberMe)
            .then((nodeResponseData) => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                }
                else {
                    if(nodeResponseData.isAuthenticated) {
                        req.session.jwtToken = nodeResponseData.token;

                        let pingIntervalTimer;
                        let pingTimeoutTimer;

                        let connectWebsocketClient = function() {
                            try {
                                const websocketClient = new webSocket(getMoarTubeNodeWebsocketUrl());

                                setWebsocketClient(websocketClient);

                                websocketClient.on('open', () => {
                                    logDebugMessageToConsole('MoarTube Client websocket connected to node: ' + getMoarTubeNodeWebsocketUrl(), null, null, true);
                                    
                                    websocketClient.send(JSON.stringify({eventName: 'register', socketType: 'moartube_client', jwtToken: req.session.jwtToken}));

                                    pingIntervalTimer = setInterval(function() {
                                        if(pingTimeoutTimer == null) {
                                            pingTimeoutTimer = setTimeout(function() {
                                                logDebugMessageToConsole('terminating likely dead MoarTube Client websocket connection to node: ' + getMoarTubeNodeWebsocketUrl(), null, null, true);

                                                clearInterval(pingIntervalTimer);
                                                websocketClient.terminate();
                                            }, 3000);

                                            //logDebugMessageToConsole('sending ping to node: ' + getMoarTubeNodeWebsocketUrl(), null, null, true);
                                            
                                            websocketClient.send(JSON.stringify({eventName: 'ping', jwtToken: req.session.jwtToken}));
                                        }
                                    }, 1000);
                                });
                                
                                websocketClient.on('message', (message) => {
                                    const parsedMessage = JSON.parse(message);
                                    
                                    if(parsedMessage.eventName === 'pong') {
                                        //logDebugMessageToConsole('received pong from node: ' + getMoarTubeNodeWebsocketUrl(), null, null, true);

                                        clearTimeout(pingTimeoutTimer);
                                        pingTimeoutTimer = null;
                                    }
                                    else if(parsedMessage.eventName === 'registered') {
                                        logDebugMessageToConsole('MoarTube Client registered websocket with node: ' + getMoarTubeNodeWebsocketUrl(), null, null, true);
                                    }
                                    else if(parsedMessage.eventName === 'echo') {
                                        if(parsedMessage.data.eventName === 'video_status') {
                                            if(parsedMessage.data.payload.type === 'importing_stopping') {
                                                stoppingVideoImport(parsedMessage.data.payload.videoId);
                                            }
                                            else if(parsedMessage.data.payload.type === 'importing_stopped') {
                                                stoppedVideoImport(parsedMessage.data.payload.videoId, parsedMessage.data);
                                            }
                                            else if(parsedMessage.data.payload.type === 'publishing_stopping') {
                                                stoppingPublishVideoEncoding(parsedMessage.data.payload.videoId);
                                            }
                                            else if(parsedMessage.data.payload.type === 'publishing_stopped') {
                                                stoppedPublishVideoEncoding(parsedMessage.data.payload.videoId, parsedMessage.data);
                                            }
                                            else if(parsedMessage.data.payload.type === 'streaming_stopping') {
                                                stoppingLiveStream(parsedMessage.data.payload.videoId);
                                            }
                                            else if(parsedMessage.data.payload.type === 'streaming_stopped') {
                                                stoppedLiveStream(parsedMessage.data.payload.videoId, parsedMessage.data);
                                            }
                                            else {
                                                websocketServerBroadcast(parsedMessage.data);
                                            }
                                        }
                                        else if(parsedMessage.data.eventName === 'video_data') {
                                            websocketServerBroadcast(parsedMessage.data);
                                        }
                                    }
                                });
                                
                                websocketClient.on('close', () => {
                                    logDebugMessageToConsole('MoarTube Client websocket disconnected from node <' + getMoarTubeNodeWebsocketUrl() + '>', null, null, true);

                                    clearInterval(pingIntervalTimer);
                                    clearInterval(pingTimeoutTimer);

                                    setTimeout(connectWebsocketClient, 1000);
                                });
                            }
                            catch(error) {
                                logDebugMessageToConsole(null, error, new Error().stack, true);
                            }
                        };
                        
                        connectWebsocketClient();
                        
                        node_getSettings(req.session.jwtToken)
                        .then(nodeResponseData => {
                            if(nodeResponseData.isError) {
                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                
                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                            }
                            else {
                                const nodeSettings = nodeResponseData.nodeSettings;
                                
                                if(nodeSettings.isNodeConfigured) {
                                    res.send({isError: false, isAuthenticated: true, redirectUrl: '/videos'});
                                }
                                else {
                                    res.send({isError: false, isAuthenticated: true, redirectUrl: '/configure'});
                                }
                            }
                        })
                        .catch(error => {
                            logDebugMessageToConsole(null, error, new Error().stack, true);
                            
                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                        });
                    }
                    else {
                        res.send({isError: false, isAuthenticated: false});
                    }
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
    }
}

function signOut_GET(req, res) {
    logDebugMessageToConsole('signing user out', null, null, true);
    
    node_doSignout(req, res);
}

module.exports = {
    signIn_GET,
    signIn_POST,
    signOut_GET
};