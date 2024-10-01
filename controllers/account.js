const webSocket = require('ws');

const { 
    logDebugMessageToConsole, getMoarTubeNodeWebsocketUrl, setMoarTubeNodeHttpProtocol, setMoarTubeNodeWebsocketProtocol, setMoarTubeNodeIp, 
    setMoarTubeNodePort, setWebsocketClient, websocketServerBroadcast
} = require('../utils/helpers');
const { node_doHeartBeat, node_doSignin, node_doSignout } = require('../utils/node-communications');
const { stoppingVideoImport, stoppedVideoImport } = require('../utils/trackers/import-video-tracker');
const { stoppingLiveStream, stoppedLiveStream } = require('../utils/trackers/live-stream-tracker');
const { stoppingPublishVideoEncoding, stoppedPublishVideoEncoding } = require('../utils/trackers/publish-video-encoding-tracker');
const { stopPendingPublishVideo } = require('../utils/trackers/pending-publish-video-tracker');

function signIn_POST(username, password, moarTubeNodeIp, moarTubeNodePort, rememberMe) {
    return new Promise(function(resolve, reject) {
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
                
                resolve({isError: true, message: 'error communicating with the MoarTube node'});
            });
        });
        
        function performSignIn(moarTubeNodeHttpProtocol, moarTubeNodeWebsocketProtocol, moarTubeNodeIp, moarTubeNodePort) {
            setMoarTubeNodeHttpProtocol(moarTubeNodeHttpProtocol);
            setMoarTubeNodeWebsocketProtocol(moarTubeNodeWebsocketProtocol);

            setMoarTubeNodeIp(moarTubeNodeIp);
            setMoarTubeNodePort(moarTubeNodePort);
            
            node_doSignin(username, password, moarTubeNodeHttpProtocol, moarTubeNodeIp, moarTubeNodePort, rememberMe)
            .then((nodeResponseData) => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    resolve({isError: true, message: nodeResponseData.message});
                }
                else {
                    if(nodeResponseData.isAuthenticated) {
                        const jwtToken = nodeResponseData.token;

                        let pingIntervalTimer;
                        let pingTimeoutTimer;

                        let connectWebsocketClient = function() {
                            try {
                                const websocketClient = new webSocket(getMoarTubeNodeWebsocketUrl());

                                setWebsocketClient(websocketClient);

                                websocketClient.on('open', () => {
                                    logDebugMessageToConsole('MoarTube Client websocket connected to node: ' + getMoarTubeNodeWebsocketUrl(), null, null, true);
                                    
                                    websocketClient.send(JSON.stringify({eventName: 'register', socketType: 'moartube_client', jwtToken: jwtToken}));

                                    pingIntervalTimer = setInterval(function() {
                                        if(pingTimeoutTimer == null) {
                                            pingTimeoutTimer = setTimeout(function() {
                                                logDebugMessageToConsole('terminating likely dead MoarTube Client websocket connection to node: ' + getMoarTubeNodeWebsocketUrl(), null, null, true);

                                                clearInterval(pingIntervalTimer);
                                                websocketClient.terminate();
                                            }, 3000);

                                            //logDebugMessageToConsole('sending ping to node: ' + getMoarTubeNodeWebsocketUrl(), null, null, true);
                                            
                                            websocketClient.send(JSON.stringify({eventName: 'ping', jwtToken: jwtToken}));
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
                                                stopPendingPublishVideo(parsedMessage.data.payload.videoId);
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

                        resolve({isError: false, isAuthenticated: true, redirectUrl: '/videos', jwtToken: jwtToken});
                    }
                    else {
                        resolve({isError: false, isAuthenticated: false});
                    }
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                resolve({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
    });
}

function signOut_GET(req, res) {
    logDebugMessageToConsole('signing user out', null, null, true);
    
    node_doSignout(req, res);
}

module.exports = {
    signIn_POST,
    signOut_GET
};