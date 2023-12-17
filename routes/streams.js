const express = require('express');
const portscanner = require('portscanner');

const { logDebugMessageToConsole } = require('../utils/helpers');
const { isPortValid } = require('../utils/validators');
const { node_isAuthenticated, node_broadcastMessage_websocket, node_stopVideoStreaming, node_streamVideo, node_setSourceFileExtension } = require('../utils/node-communications');

const router = express.Router();

router.post('/start', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then((nodeResponseData) => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const title = req.body.title;
                const description = req.body.description;
                const tags = req.body.tags;
                const rtmpPort = req.body.rtmpPort;
                const resolution = req.body.resolution;
                const isRecordingStreamRemotely = req.body.isRecordingStreamRemotely;
                const isRecordingStreamLocally = req.body.isRecordingStreamLocally;
                const networkAddress = req.body.networkAddress;

                if(!isPortValid(rtmpPort)) {
                    res.send({isError: true, message: 'rtmpPort is not valid'});
                }
                else {
                    portscanner.checkPortStatus(rtmpPort, '127.0.0.1', function(error, portStatus) {
                        if (error) {
                            res.send({isError: true, message: 'an error occurred while checking the availability of port ' + rtmpPort});
                        }
                        else {
                            if (portStatus === 'closed') {
                                const uuid = 'moartube';
                                
                                node_streamVideo(jwtToken, title, description, tags, rtmpPort, uuid, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress)
                                .then(nodeResponseData => {
                                    if(nodeResponseData.isError) {
                                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                        
                                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                    }
                                    else {
                                        const videoId = nodeResponseData.videoId;
                                        
                                        publishStreamTracker[videoId] = {process: null, stopping: false};
                                        
                                        node_setSourceFileExtension(jwtToken, videoId, '.ts')
                                        .then(nodeResponseData => {
                                            if(nodeResponseData.isError) {
                                                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                                                
                                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                            }
                                            else {
                                                const rtmpUrl = 'rtmp://' + networkAddress + ':' + rtmpPort + '/live/' + uuid;
                                                
                                                performStreamingJob(jwtToken, videoId, title, description, tags, rtmpUrl, 'm3u8', resolution, isRecordingStreamRemotely, isRecordingStreamLocally);
                                                
                                                res.send({isError: false, rtmpUrl: rtmpUrl});
                                            }
                                        })
                                        .catch(error => {
                                            logDebugMessageToConsole(null, error, new Error().stack, true);
                                            
                                            res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                        });
                                    }
                                })
                                .catch(error => {
                                    logDebugMessageToConsole(null, error, new Error().stack, true);
                                    
                                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                                });
                            } else {
                                res.send({isError: true, message: 'port ' + rtmpPort + ' is not available'});
                            }
                        }
                    });
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

router.post('/:videoId/stop', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const videoId = req.params.videoId;
                
                node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopping', videoId: videoId }}});
                
                node_stopVideoStreaming(jwtToken, videoId)
                .then((nodeResponseData) => {
                    if(nodeResponseData.isError) {
                        logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                        
                        res.send({isError: true, message: 'error communicating with the MoarTube node'});
                    }
                    else {
                        node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopped', videoId: videoId }}});
                        
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