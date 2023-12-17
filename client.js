const http = require('http');
const express = require('express');
const expressSession = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const spawn = require('child_process').spawn;
const spawnSync = require('child_process').spawnSync;
const execSync = require('child_process').execSync;
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const webSocket = require('ws');
const crypto = require('crypto');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const portscanner = require('portscanner');










const { startPublishInterval } = require('./utils/video-publish-monitor');

const homeRoutes = require('./routes/home');
const accountRoutes = require('./routes/account');
const configureRoutes = require('./routes/configure');
const settingsRoutes = require('./routes/settings');
const videosRoutes = require('./routes/videos');
const streamsRoutes = require('./routes/streams');
const reportsRoutes = require('./routes/reports');
const reportsVideosRoutes = require('./routes/reports-videos');
const reportsCommentsRoutes = require('./routes/reports-comments');
const commentsRoutes = require('./routes/comments');
const channelRoutes = require('./routes/channel');

const { 
	logDebugMessageToConsole, 
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
    setPublicDirectoryPath,
    setUserDirectoryPath,
    setTempDirectoryPath,
    setTempCertificatesDirectoryPath,
    setTempVideosDirectoryPath,
    setMoarTubeClientPort,
    setMoarTubeNodeIp,
    setMoarTubeNodePort,
    setMoarTubeNodeHttpProtocol,
    setMoarTubeNodeWebsocketProtocol 
} = require('./utils/helpers');




var USER_DIRECTORY;
var PUBLIC_DIRECTORY;
var TEMP_DIRECTORY;
var TEMP_CERTIFICATES_DIRECTORY;
var TEMP_VIDEOS_DIRECTORY;

var MOARTUBE_CLIENT_PORT;

var MOARTUBE_NODE_IP;
var MOARTUBE_NODE_PORT;
var MOARTUBE_NODE_HTTP_PROTOCOL;
var MOARTUBE_NODE_WEBSOCKET_PROTOCOL;

loadConfig();

startClient();

async function startClient() {
	process.on('uncaughtException', (error) => {
		logDebugMessageToConsole(null, error, error.stackTrace, true);
	});

	process.on('unhandledRejection', (reason, promise) => {
		logDebugMessageToConsole(null, reason, reason.stack, true);
	});

	logDebugMessageToConsole('using ffmpeg at path: ' + ffmpegPath, null, null, true);
	logDebugMessageToConsole(execSync(ffmpegPath + ' -version').toString(), null, null, true);

	logDebugMessageToConsole('creating required directories', null, null, true);
	
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

	await cleanVideosDirectory();
	
	performEncodingDecodingAssessment();

	startPublishInterval();
	
	const publishStreamTracker = {};
	
	const app = express();
	
	app.enable('trust proxy');

	app.use('/javascript', express.static(path.join(getPublicDirectoryPath(), 'javascript')));
	app.use('/css', express.static(path.join(getPublicDirectoryPath(), 'css')));
	app.use('/images', express.static(path.join(getPublicDirectoryPath(), 'images')));
	app.use('/fonts', express.static(path.join(getPublicDirectoryPath(), 'fonts')));
	
	const sessionMiddleware = expressSession({
		name: crypto.randomBytes(64).toString('hex'),
		secret: crypto.randomBytes(64).toString('hex'),
		resave: false,
		saveUninitialized: true
	});
	
	app.use(sessionMiddleware);
	
	app.use(bodyParser.urlencoded({ extended: false }));
	app.use(bodyParser.json());

	app.use('/', homeRoutes);
	app.use('/account', accountRoutes);
	app.use('/configure', configureRoutes);
	app.use('/settings', settingsRoutes);
	app.use('/videos', videosRoutes);
	app.use('/streams', streamsRoutes);
	app.use('/reports', reportsRoutes);
	app.use('/reports/videos', reportsVideosRoutes);
	app.use('/reports/comments', reportsCommentsRoutes);
	app.use('/comments', commentsRoutes);
	app.use('/channel', channelRoutes);

	
	
	const httpServer = http.createServer(app);

	httpServer.requestTimeout = 0; // needed for long duration requests (streaming, large uploads)

	var websocketServer;
	
	httpServer.listen(getMoarTubeClientPort(), function() {
		logDebugMessageToConsole('MoarTube Client is listening on port ' + getMoarTubeClientPort(), null, null, true);
		
		websocketServer = new webSocket.Server({ 
			noServer: true, 
			perMessageDeflate: false 
		});
		
		websocketServer.on('connection', function connection(ws) {
			logDebugMessageToConsole('browser websocket client connected', null, null, true);

			ws.on('close', () => {
				logDebugMessageToConsole('browser websocket client disconnected', null, null, true);
			});
		});
		
		httpServer.on('upgrade', function upgrade(req, socket, head) {
			websocketServer.handleUpgrade(req, socket, head, function done(ws) {
				sessionMiddleware(req, {}, () => {
					node_isAuthenticated(req.session.jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
						}
						else {
							if(nodeResponseData.isAuthenticated) {
								websocketServer.emit('connection', ws, req);
							}
							else {
								ws.close();
							}
						}
					})
					.catch(error => {
						logDebugMessageToConsole(null, error, new Error().stack, true);
					});
				});
			});
		});
	});
	
	app.use(function(req, res, next) {
		next();
	});
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	app.get('/videos/:videoId/publishes', (req, res) => {
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
					
					node_getVideoPublishes_filesystem(jwtToken, videoId)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							res.send({isError: false, publishes: nodeResponseData.publishes});
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
	
	app.get('/videos/:videoId/information', (req, res) => {
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
					
					node_getVideoInformation_database(jwtToken, videoId)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							res.send({isError: false, information: nodeResponseData.information});
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
	
	app.post('/videos/:videoId/information', (req, res) => {
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
					const title = req.body.title;
					const description = req.body.description;
					const tags = req.body.tags;
					
					node_setVideoInformation_database(jwtToken, videoId, title, description, tags)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							res.send({isError: false, information: nodeResponseData.information});
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
	
	app.post('/videos/delete', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const videoIdsJson = req.body.videoIdsJson;
					
					node_videosDelete_database_filesystem(jwtToken, videoIdsJson)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const deletedVideoIds = nodeResponseData.deletedVideoIds;
							const nonDeletedVideoIds = nodeResponseData.nonDeletedVideoIds;

							for(const deletedVideoId of deletedVideoIds) {
								const deletedVideoIdPath = path.join(TEMP_VIDEOS_DIRECTORY, deletedVideoId);
								
								deleteDirectoryRecursive(deletedVideoIdPath);
							}
							
							res.send({isError: false, deletedVideoIds: deletedVideoIds, nonDeletedVideoIds: nonDeletedVideoIds});
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
	
	app.post('/videos/finalize', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const videoIdsJson = req.body.videoIdsJson;
					
					node_videosFinalize_database_filesystem(jwtToken, videoIdsJson)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const finalizedVideoIds = nodeResponseData.finalizedVideoIds;
							const nonFinalizedVideoIds = nodeResponseData.nonFinalizedVideoIds;
							
							for(const finalizedVideoId of finalizedVideoIds) {
								const videoDirectory = path.join(TEMP_VIDEOS_DIRECTORY, finalizedVideoId);
								
								deleteDirectoryRecursive(videoDirectory);
								
								node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'finalized', videoId: finalizedVideoId }}});
							}
							
							res.send({isError: false, finalizedVideoIds: finalizedVideoIds, nonFinalizedVideoIds: nonFinalizedVideoIds});
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
	
	app.post('/videos/:videoId/index/add', (req, res) => {
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
					const captchaResponse = req.body.captchaResponse;
					const containsAdultContent = req.body.containsAdultContent;
					const termsOfServiceAgreed = req.body.termsOfServiceAgreed;

					node_addVideoToIndex(jwtToken, videoId, captchaResponse, containsAdultContent, termsOfServiceAgreed)
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
	
	app.post('/videos/:videoId/index/remove', (req, res) => {
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

					node_removeVideoFromIndex(jwtToken, videoId)
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
	
	app.post('/videos/:videoId/alias', (req, res) => {
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
					const captchaResponse = req.body.captchaResponse;
					
					node_doAliasVideo(jwtToken, videoId, captchaResponse)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: nodeResponseData.message});
						}
						else {
							res.send({isError: false, videoAliasUrl: nodeResponseData.videoAliasUrl});
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
	
	app.get('/videos/:videoId/alias', (req, res) => {
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
					
					node_getVideoAlias(jwtToken, videoId)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: nodeResponseData.message});
						}
						else {
							res.send({isError: false, videoAliasUrl: nodeResponseData.videoAliasUrl});
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
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	


	// Serve the settings page
	app.get('/settings', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

				signUserOut(req, res);
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getSettings(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							signUserOut(req, res);
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured) {
								const pagePath = path.join(PUBLIC_DIRECTORY, 'pages/settings.html');
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
						
						signUserOut(req, res);
					});
				}
				else {
					res.redirect('/account/signin');
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			signUserOut(req, res);
		});
	});
	
	app.get('/settings/client', (req, res) => {
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
	
	app.get('/settings/node', (req, res) => {
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
	
	
	
	app.post('/settings/node/avatar', (req, res) => {
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
								const filePath = path.join(PUBLIC_DIRECTORY, 'images');
								
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
							
							const imagesDirectory = path.join(PUBLIC_DIRECTORY, 'images');
						
							const sourceFilePath = path.join(imagesDirectory, avatarFile.filename);
							
							const iconDestinationFilePath = path.join(imagesDirectory, 'icon.png');
							const avatarDestinationFilePath = path.join(imagesDirectory, 'avatar.png');
							
							sharp(sourceFilePath).resize({width: 48}).resize(48, 48).png({ compressionLevel: 9 }).toFile(iconDestinationFilePath)
							.then(() => {
								sharp(sourceFilePath).resize({width: 128}).resize(128, 128).png({ compressionLevel: 9 }).toFile(avatarDestinationFilePath)
								.then(() => {
									node_setAvatar_fileSystem(jwtToken, iconDestinationFilePath, avatarDestinationFilePath)
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
	
	app.get('/settings/node/banner', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.end();
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getBanner_fileSystem(jwtToken)
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
	
	app.post('/settings/node/banner', (req, res) => {
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
								const filePath = path.join(PUBLIC_DIRECTORY, 'images');
								
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
							
							const imagesDirectory = path.join(PUBLIC_DIRECTORY, 'images');
						
							const sourceFilePath = path.join(imagesDirectory, bannerFile.filename);
							
							const bannerDestinationFilePath = path.join(imagesDirectory, 'banner.png');
							
							sharp(sourceFilePath).resize({width: 2560}).resize(2560, 424).png({ compressionLevel: 9 }).toFile(bannerDestinationFilePath)
							.then(() => {
								fs.unlinkSync(sourceFilePath);
								
								node_setBanner_fileSystem(jwtToken, bannerDestinationFilePath)
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
	
	app.post('/settings/node/personalize', (req, res) => {
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
					
					node_setNodeName_filesystem(jwtToken, nodeName, nodeAbout, nodeId)
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

	
	
	app.post('/settings/node/secure', (req, res) => {
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
									fs.access(TEMP_CERTIFICATES_DIRECTORY, fs.F_OK, function(error) {
										if(error) {
											cb(new Error('file upload error'));
										}
										else {
											cb(null, TEMP_CERTIFICATES_DIRECTORY);
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
											MOARTUBE_NODE_HTTP_PROTOCOL = 'https';
											MOARTUBE_NODE_WEBSOCKET_PROTOCOL = 'wss';
											
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
								MOARTUBE_NODE_HTTP_PROTOCOL = 'http';
								MOARTUBE_NODE_WEBSOCKET_PROTOCOL = 'ws';
								
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
	
	app.post('/settings/node/network/internal', (req, res) => {
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
					
					node_setNetworkInternal_filesystem(jwtToken, nodeListeningPort)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: nodeResponseData.message});
						}
						else {
							MOARTUBE_NODE_PORT = nodeListeningPort;
							
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
	
	
	
	
	
	
	
	
	app.post('/settings/client/gpuAcceleration', (req, res) => {
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
	
	app.post('/settings/account/update', (req, res) => {
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
					
					node_setAccountCredentials_filesystem(jwtToken, username, password)
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
	
	app.post('/settings/cloudflare/update', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const cloudflareAccountId = req.body.cloudflareAccountId;
					const cloudflareApiKey = req.body.cloudflareApiKey;
					
					node_setCloudflareCredentials_filesystem(jwtToken, cloudflareAccountId, cloudflareApiKey)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							res.send({isError: false, cloudflareAccountId: nodeResponseData.cloudflareAccountId, cloudflareApiKey: nodeResponseData.cloudflareApiKey});
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
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	// Retrieve and serve a captcha
	app.get('/index/captcha', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getIndexerCaptcha(jwtToken)
					.then(nodeResponseData => {
						/*
						the node's response will be either JSON or a PNG image
						JSON if there's an error to report (namely an unconfigured node)
						PNG image is captcha if node has been configured
						*/
						if(nodeResponseData.headers['content-type'].includes('application/json')) {
							let data = '';
							
							nodeResponseData.on('data', function(chunk) {
								data += chunk;
							});
							
							nodeResponseData.on('end', function() {
								try {
									const jsonData = JSON.parse(data);
									res.send(jsonData);
								}
								catch (error) {
									res.send({isError: true, message: 'error communicating with the MoarTube node'});
								}
							});
						}
						else {
							res.setHeader('Content-Type', 'image/png');
							nodeResponseData.pipe(res);
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
	
	app.get('/alias/captcha', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getAliaserCaptcha(jwtToken)
					.then(nodeResponseData => {
						/*
						the node's response will be either JSON or a PNG image
						JSON if there's an error to report (namely an unconfigured node)
						PNG image is captcha if node has been configured
						*/
						if(nodeResponseData.headers['content-type'].includes('application/json')) {
							let data = '';
							
							nodeResponseData.on('data', function(chunk) {
								data += chunk;
							});
							
							nodeResponseData.on('end', function() {
								try {
									const jsonData = JSON.parse(data);
									res.send(jsonData);
								}
								catch (error) {
									logDebugMessageToConsole(null, error, new Error().stack, true);

									res.send({isError: true, message: 'error communicating with the MoarTube node'});
								}
							});
						}
						else {
							res.setHeader('Content-Type', 'image/png');
							nodeResponseData.pipe(res);
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
	
	app.get('/streams/:videoId/rtmp/information', (req, res) => {
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
					
					node_getVideoData_database(jwtToken, videoId)
					.then(nodeResponseData => {
						const meta = JSON.parse(nodeResponseData.videoData.meta);

						const netorkAddress = meta.networkAddress;
						const rtmpPort = meta.rtmpPort;
						const uuid = meta.uuid;

						const rtmpStreamUrl = 'rtmp://' + netorkAddress + ':' + rtmpPort + '/live/' + uuid;
						const rtmpServerUrl = 'rtmp://' + netorkAddress + ':' + rtmpPort + '/live';
						const rtmpStreamkey = uuid;

						res.send({isError: false, rtmpStreamUrl: rtmpStreamUrl, rtmpServerUrl: rtmpServerUrl, rtmpStreamkey: rtmpStreamkey});
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
	
	app.get('/streams/:videoId/chat/settings', (req, res) => {
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
					
					node_getVideoData_database(jwtToken, videoId)
					.then(nodeResponseData => {
						const meta = JSON.parse(nodeResponseData.videoData.meta);
						
						const isChatHistoryEnabled = meta.chatSettings.isChatHistoryEnabled;
						const chatHistoryLimit = meta.chatSettings.chatHistoryLimit;
						
						res.send({isError: false, isChatHistoryEnabled: isChatHistoryEnabled, chatHistoryLimit: chatHistoryLimit});
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
	
	app.post('/streams/:videoId/chat/settings', (req, res) => {
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
					const isChatHistoryEnabled = req.body.isChatHistoryEnabled;
					const chatHistoryLimit = req.body.chatHistoryLimit;
					
					node_setVideoChatSettings(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit)
					.then(nodeResponseData => {
						res.send(nodeResponseData);
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

	app.get('/network', (req, res) => {
		const networkAddresses = getNetworkAddresses();
		
		res.send({isError: false, networkAddresses: networkAddresses});
	});

	app.get('/heartbeat', (req, res) => {
		res.end();
	});
	
	
	
	
	/* axios calls */
	
	
	
	
	
	function node_getHeartbeat_2() {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/heartbeat')
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	

	
	
	
	
	
	
	
	
	
	
	
	
	function node_getVideoPublishes_filesystem(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/publishes', {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	
	
	function node_setVideoInformation_database(jwtToken, videoId, title, description, tags) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/information', {
				title: title,
				description: description,
				tags: tags
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	
	
	
	
	function node_getNextExpectedSegmentIndex_filesystem(jwtToken, videoId, format, resolution) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/streams/' + videoId + '/adaptive/' + format + '/' + resolution + '/segments/nextExpectedSegmentIndex', {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_getVideoBandwidth_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/streams/' + videoId + '/bandwidth', {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	
	
	
	
	function node_setVideoChatSettings(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/stream/' + videoId + '/chat/settings', {
				isChatHistoryEnabled: isChatHistoryEnabled,
				chatHistoryLimit: chatHistoryLimit
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	
	
	function node_videosDelete_database_filesystem(jwtToken, videoIdsJson) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/delete', {
				videoIdsJson: videoIdsJson
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_videosFinalize_database_filesystem(jwtToken, videoIdsJson) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/finalize', {
				videoIdsJson: videoIdsJson
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	
	
	

	
	function node_setNodeName_filesystem(jwtToken, nodeName, nodeAbout, nodeId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/node/personalize', {
				nodeName: nodeName,
				nodeAbout: nodeAbout,
				nodeId: nodeId
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_setAccountCredentials_filesystem(jwtToken, username, password) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/account/update', {
				username: username,
				password: password
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_setCloudflareCredentials_filesystem(jwtToken, cloudflareAccountId, cloudflareApiKey) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/cloudflare/update', {
				cloudflareAccountId: cloudflareAccountId,
				cloudflareApiKey: cloudflareApiKey
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	
	
	
	
	
	
	
	
	
	function node_setAvatar_fileSystem(jwtToken, iconPath, avatarPath) {
		return new Promise(function(resolve, reject) {
			const iconFileStream = fs.createReadStream(iconPath);
			const avatarFileStream = fs.createReadStream(avatarPath);
			
			const formData = new FormData();
			formData.append('iconFile', iconFileStream, 'icon.png');
			formData.append('avatarFile', avatarFileStream, 'avatar.png');
			
			const headers = formData.getHeaders();
			headers.Authorization = jwtToken;
			
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/node/avatar', formData, {
			  headers: headers
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_getBanner_fileSystem(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/banner', {
			  headers: {
				Authorization: jwtToken
			  },
			  responseType: 'stream'
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_setBanner_fileSystem(jwtToken, bannerPath) {
		return new Promise(function(resolve, reject) {
			const bannerFileStream = fs.createReadStream(bannerPath);
			
			const formData = new FormData();
			formData.append('bannerFile', bannerFileStream, 'banner.png');
			
			const headers = formData.getHeaders();
			headers.Authorization = jwtToken;
			
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/banner', formData, {
			  headers: headers
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}

	function node_uploadVideo_fileSystem(jwtToken, videoId, format, resolution, directoryPaths) {
		return new Promise(function(resolve, reject) {
			const formData = new FormData();
			
			for (directoryPath of directoryPaths) {
				const fileName = directoryPath.fileName;
				const filePath = directoryPath.filePath;
				const fileStream = fs.createReadStream(filePath);
				
				formData.append('video_files', fileStream, fileName);
			}

			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/upload', formData, {
				params: {
					format: format,
					resolution: resolution
				},
				headers: {
					Authorization: jwtToken
				}
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_uploadStream_fileSystem(jwtToken, videoId, format, resolution, directoryPaths) {
		return new Promise(function(resolve, reject) {
			const formData = new FormData();
			for (directoryPath of directoryPaths) {
				const fileName = directoryPath.fileName;
				const filePath = directoryPath.filePath;
				const fileStream = fs.createReadStream(filePath);
				
				formData.append('video_files', fileStream, fileName);
			}

			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/stream', formData, {
				params: {
					format: format,
					resolution: resolution
				},
				headers: {
					Authorization: jwtToken
				}
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/streams/' + videoId + '/adaptive/' + format + '/' + resolution + '/segments/remove', {
				segmentName: segmentName
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_setNetworkInternal_filesystem(jwtToken, listeningNodePort) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/node/network/internal', {
				listeningNodePort: listeningNodePort
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_addVideoToIndex(jwtToken, videoId, captchaResponse, containsAdultContent, termsOfServiceAgreed) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/index/add', {
				captchaResponse: captchaResponse,
				containsAdultContent: containsAdultContent,
				termsOfServiceAgreed: termsOfServiceAgreed
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_removeVideoFromIndex(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/index/remove', {
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_doAliasVideo(jwtToken, videoId, captchaResponse) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/alias', {
				captchaResponse: captchaResponse
			}, {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_getVideoAlias(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/alias', {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_getIndexerCaptcha(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/index/captcha', {
			  headers: {
				Authorization: jwtToken
			  },
			  responseType: 'stream'
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_getAliaserCaptcha(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/alias/captcha', {
			  headers: {
				Authorization: jwtToken
			  },
			  responseType: 'stream'
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	function node_getVideoReports(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/node/reports/videos', {
			  headers: {
				Authorization: jwtToken
			  }
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
	

	function node_setSecureConnection(jwtToken, isSecure, keyFile, certFile, caFiles) {
		return new Promise(function(resolve, reject) {
			const formData = new FormData();
			
			if(keyFile != null) {
				const keyFileStream = fs.createReadStream(keyFile.path);
				formData.append('keyFile', keyFileStream, 'private_key.pem');
			}
			
			if(certFile != null) {
				const certFileStream = fs.createReadStream(certFile.path);
				formData.append('certFile', certFileStream, 'certificate.pem');
			}
			
			if(caFiles != null) {
				for(const caFile of caFiles) {
					const caFileStream = fs.createReadStream(caFile.path);
					
					formData.append('caFiles', caFileStream, caFile.filename);
				}
			}
			
			const headers = formData.getHeaders();
			headers.Authorization = jwtToken;
			
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/node/secure?isSecure=' + isSecure, formData, {
			  headers: headers
			})
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
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
	
	function detectOperatingSystem() {
		const os = require('os');
		
		const platform = os.platform();
		
		return platform;
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
	
	function detectSystemGpu() {
		return new Promise(function(resolve, reject) {
			const systemInformation = require('systeminformation');
			
			systemInformation.graphics()
			.then(function(data) {
				var processingAgentName = '';
				var processingAgentModel = '';
				
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
	
	
	
	function generateFfmpegLiveArguments(videoId, resolution, format, rtmpUrl, isRecordingStreamRemotely) {
		var scale = '';
		var width = '';
		var height = '';
		var bitrate = '';
		
		if(resolution === '2160p') {
			width = '3840';
			height = '2160';
			bitrate = '10000k';
		}
		else if(resolution === '1440p') {
			width = '2560';
			height = '1440';
			bitrate = '8000k';
		}
		else if(resolution === '1080p') {
			width = '1920';
			height = '1080';
			bitrate = '6000k';
		}
		else if(resolution === '720p') {
			width = '1280';
			height = '720';
			bitrate = '4000k';
		}
		else if(resolution === '480p') {
			width = '854';
			height = '480';
			bitrate = '2000k';
		}
		else if(resolution === '360p') {
			width = '640';
			height = '360';
			bitrate = '1500k';
		}
		else if(resolution === '240p') {
			width = '426';
			height = '240';
			bitrate = '700k';
		}
		
		const clientSettings = getClientSettings();

		if(clientSettings.processingAgent.processingAgentType === 'cpu' || format === 'webm' || format === 'ogv') {
			scale = 'scale';
		}
		else if(clientSettings.processingAgent.processingAgentType === 'gpu' && (format === 'm3u8' || format === 'mp4')) {
			if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
				scale = 'scale_cuda';
			}
			else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
				scale = 'scale';
			}
		}
		
		var filterComplex = scale + "='if(gt(ih,iw),-1," + width + ")':'if(gt(ih,iw)," + height + ",-1)',";
		
		if(clientSettings.processingAgent.processingAgentType === 'cpu' || format === 'webm' || format === 'ogv') {
			filterComplex += 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
		}
		else if(clientSettings.processingAgent.processingAgentType === 'gpu' && (format === 'm3u8' || format === 'mp4')) {
			if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
				filterComplex += 'hwdownload,format=nv12,crop=trunc(iw/2)*2:trunc(ih/2)*2,hwupload_cuda';
			}
			else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
				filterComplex += 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
			}
		}

		
		const hlsSegmentOutputPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/' + resolution + '/segment-' + resolution + '-%d.ts');
		const manifestFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/manifest-' + resolution + '.m3u8');
		
		var ffmpegArguments = [];
		
		if(clientSettings.processingAgent.processingAgentType === 'cpu') {
			if(format === 'm3u8') {
				ffmpegArguments = [
					'-listen', '1',
					'-timeout', '10000',
					'-f', 'flv',
					'-i', rtmpUrl,
					'-c:v', 'libx264',
					'-sc_threshold', '0',
					'-g', '90',  // GOP size = (frame rate) * (segment length)
					'-c:a', 'aac',
					'-f', 'hls', 
					'-hls_time', '3', '-hls_init_time', '3', '-hls_list_size', '20',
					'-hls_segment_filename', hlsSegmentOutputPath,
					'-hls_base_url', '/' + videoId + '/adaptive/m3u8/' + resolution + '/segments/', 
					'-hls_playlist_type', 'event', 
					'-hls_flags', 'append_list',
					manifestFilePath
				];
			}
		}
		else if(clientSettings.processingAgent.processingAgentType === 'gpu') {
			if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
				if(format === 'm3u8') {
					ffmpegArguments = [
						'-listen', '1',
						'-timeout', '10000',
						'-hwaccel', 'cuvid',
						'-hwaccel_output_format', 'cuda',
						'-f', 'flv',
						'-i', rtmpUrl, 
						'-c:v', 'h264_nvenc',
						'-profile:v', 'high',
						'-preset', 'p6',
						'-sc_threshold', '0',
						'-g', '90',  // GOP size = (frame rate) * (segment length)
						'-c:a', 'aac',
						'-f', 'hls', 
						'-hls_time', '3', '-hls_init_time', '3', '-hls_list_size', '20',
						'-hls_segment_filename', hlsSegmentOutputPath,
						'-hls_base_url', '/' + videoId + '/adaptive/m3u8/' + resolution + '/segments/', 
						'-hls_playlist_type', 'event', 
						'-hls_flags', 'append_list',
						manifestFilePath
					];
				}
			}
			else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
				if(format === 'm3u8') {
					ffmpegArguments = [
						'-listen', '1',
						'-timeout', '10000',
						'-hwaccel', 'dxva2',
						'-hwaccel_device', '0',
						'-f', 'flv',
						'-i', rtmpUrl, 
						'-c:v', 'h264_amf',
						'-sc_threshold', '0',
						'-g', '90',  // GOP size = (frame rate) * (segment length)
						'-c:a', 'aac',
						'-f', 'hls', 
						'-hls_time', '3', '-hls_init_time', '3', '-hls_list_size', '20',
						'-hls_segment_filename', hlsSegmentOutputPath,
						'-hls_base_url', '/' + videoId + '/adaptive/m3u8/' + resolution + '/segments/', 
						'-hls_playlist_type', 'event', 
						'-hls_flags', 'append_list',
						manifestFilePath
					];
				}
			}
		}
		
		/*
		hls_list_size will be enforced if not recording remotely, otherwise hls_list_size will be 0 (no list size limit) if stream is recording remotely
		*/
		if(!isRecordingStreamRemotely) {
			ffmpegArguments.splice(ffmpegArguments.indexOf('-hls_playlist_type'), 1);
			ffmpegArguments.splice(ffmpegArguments.indexOf('event'), 1);
		}
		
		return ffmpegArguments;
	}
	
	
	
	function performStreamingJob(jwtToken, videoId, title, description, tags, rtmpUrl, format, resolution, isRecordingStreamRemotely, isRecordingStreamLocally) {
		return new Promise(function(resolve, reject) {
			logDebugMessageToConsole('starting live stream for id: ' + videoId, null, null, true);
			
			fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/source'), { recursive: true });
			fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images'), { recursive: true });
			fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive'), { recursive: true });
			fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive'), { recursive: true });
			
			const sourceDirectoryPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/source');
			const sourceFilePath = path.join(sourceDirectoryPath, '/' + videoId + '.ts');
			const videoDirectory = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8');
			const manifestFileName = 'manifest-' + resolution + '.m3u8';
			const manifestFilePath = path.join(videoDirectory, '/' + manifestFileName);
			const segmentsDirectoryPath = path.join(videoDirectory, '/' + resolution);
			
			fs.mkdirSync(segmentsDirectoryPath, { recursive: true });
			
			const ffmpegArguments = generateFfmpegLiveArguments(videoId, resolution, format, rtmpUrl, isRecordingStreamRemotely);
			
			var process = spawn(ffmpegPath, ffmpegArguments);
			
			publishStreamTracker[videoId].process = process;
			
			var lengthSeconds = 0;
			var lengthTimestamp = '';
			process.stderr.on('data', function (data) {
				if(!publishStreamTracker[videoId].stopping) {
					const stderrTemp = Buffer.from(data).toString();
					logDebugMessageToConsole(stderrTemp, null, null, true);
					
					if(stderrTemp.indexOf('time=') != -1) {
						var index = stderrTemp.indexOf('time=');
						lengthTimestamp = stderrTemp.substr(index + 5, 11);
						lengthSeconds = timestampToSeconds(lengthTimestamp);
						
						node_setVideoLengths_database(jwtToken, videoId, lengthSeconds, lengthTimestamp)
						.then(nodeResponseData => {
							if(nodeResponseData.isError) {
								logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							}
							else {
								// do nothing
							}
						})
						.catch(error => {
							logDebugMessageToConsole(null, error, new Error().stack, true);
						});
					}
				}
			});
			
			var segmentInterval;

			process.on('spawn', function (code) {
				logDebugMessageToConsole('performStreamingJob ffmpeg process spawned with arguments: ' + ffmpegArguments, null, null, true);
				
				const segmentHistoryLength = 20;
				
				segmentInterval = setInterval(function() {
					if(!publishStreamTracker[videoId].stopping) {
						(function() {
							node_getNextExpectedSegmentIndex_filesystem(jwtToken, videoId, format, resolution)
							.then(nodeResponseData => {
								if(nodeResponseData.isError) {
									logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
								}
								else {
									const nextExpectedSegmentIndex = nodeResponseData.nextExpectedSegmentIndex;
									const segmentIndexToDelete = nextExpectedSegmentIndex - segmentHistoryLength;
									
									if(segmentIndexToDelete >= 0) {
										const segmentIndexToDeleteFileName = 'segment-' + resolution + '-' + segmentIndexToDelete + '.ts';
										const segmentIndexToDeleteFilePath = path.join(segmentsDirectoryPath, '/' + segmentIndexToDeleteFileName);
										
										fs.access(segmentIndexToDeleteFilePath, fs.F_OK, function(error) {
											if(error) {
												
											}
											else {
												fs.unlink(segmentIndexToDeleteFilePath, function(error){
													
													
												});
											}
										});
									}
									
									logDebugMessageToConsole('node expects the next segment index to be sent: ' + nextExpectedSegmentIndex, null, null, true);
									
									const expectedSegmentFileName = 'segment-' + resolution + '-' + nextExpectedSegmentIndex + '.ts';
									const expectedSegmentFilePath = path.join(segmentsDirectoryPath, '/' + expectedSegmentFileName);
									
									if(fs.existsSync(manifestFilePath) && fs.existsSync(expectedSegmentFilePath)) {
										logDebugMessageToConsole('generating live images for video: ' + videoId, null, null, true);
										
										const imagesDirectoryPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images');
										
										const thumbnailImagePath = path.join(imagesDirectoryPath, 'thumbnail.jpg');
										
										var process1 = spawn(ffmpegPath, [
											'-i', expectedSegmentFilePath, 
											'-vf', 'select=\'gte(t,3*25/100)\',crop=min(iw\\,ih):min(iw\\,ih),scale=100:100,setsar=1',
											'-vframes', '1',
											'-y',
											thumbnailImagePath
										]);
										
										process1.on('spawn', function (code) {
											logDebugMessageToConsole('live thumbnail generating ffmpeg process spawned', null, null, true);
										});
										
										process1.on('exit', function (code) {
											logDebugMessageToConsole('live thumbnail generating ffmpeg process exited with exit code: ' + code, null, null, true);
											
											if(code === 0) {
												const thumbnailPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/thumbnail.jpg');
												
												if(fs.existsSync(thumbnailPath)) {
													logDebugMessageToConsole('generated live thumbnail for video: ' + videoId, null, null, true);
													
													logDebugMessageToConsole('uploading live thumbnail to node for video: ' + videoId, null, null, true);
													
													node_setThumbnail_fileSystem(jwtToken, videoId, thumbnailPath)
													.then(nodeResponseData => {
														if(nodeResponseData.isError) {
															logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
														}
														else {
															logDebugMessageToConsole('uploaded live thumbnail to node for video: ' + videoId, null, null, true);
															
															//fs.unlinkSync(thumbnailPath);
														}
													})
													.catch(error => {
														logDebugMessageToConsole(null, error, new Error().stack, true);
													});
												} else {
													logDebugMessageToConsole('expected a live thumbnail to be generated in <' + thumbnailPath + '> but found none', null, null, true);
												}
											}
											else {
												logDebugMessageToConsole('live thumbnail generating exited with code: ' + code, null, null, true);
											}
										});
										
										process1.on('error', function (code) {
											logDebugMessageToConsole('live thumbnail generating errorred with error code: ' + code, null, null, true);
										});

										const previewImagePath = path.join(imagesDirectoryPath, 'preview.jpg');
										
										var process2 = spawn(ffmpegPath, [
											'-i', expectedSegmentFilePath, 
											'-vf', 'select=\'gte(t,3*25/100)\',scale=512:288:force_original_aspect_ratio=decrease,pad=512:288:(ow-iw)/2:(oh-ih)/2,setsar=1',
											'-vframes', '1',
											'-y',
											previewImagePath
										]);
										
										process2.on('spawn', function (code) {
											logDebugMessageToConsole('live preview generating ffmpeg process spawned', null, null, true);
										});
										
										process2.on('exit', function (code) {
											logDebugMessageToConsole('live preview generating ffmpeg process exited with exit code: ' + code, null, null, true);
											
											if(code === 0) {
												const previewPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/preview.jpg');
												
												if(fs.existsSync(previewPath)) {
													logDebugMessageToConsole('generated live preview for video: ' + videoId, null, null, true);
													
													logDebugMessageToConsole('uploading live preview to node for video: ' + videoId, null, null, true);
													
													node_setPreview_fileSystem(jwtToken, videoId, previewPath)
													.then(nodeResponseData => {
														if(nodeResponseData.isError) {
															logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
														}
														else {
															logDebugMessageToConsole('uploaded live preview to node for video: ' + videoId, null, null, true);
															
															//fs.unlinkSync(previewPath);
														}
													})
													.catch(error => {
														logDebugMessageToConsole(null, error, new Error().stack, true);
													});
												} else {
													logDebugMessageToConsole('expected a live preview to be generated in <' + previewPath + '> but found none', null, null, true);
												}
											}
											else {
												logDebugMessageToConsole('live preview generating exited with code: ' + code, null, null, true);
											}
										});
										
										process2.on('error', function (code) {
											logDebugMessageToConsole('live preview generating errorred with error code: ' + code, null, null, true);
										});

										const posterImagePath = path.join(imagesDirectoryPath, 'poster.jpg');
										
										var process3 = spawn(ffmpegPath, [
											'-i', expectedSegmentFilePath, 
											'-vf', 'select=\'gte(t,3*25/100)\',scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
											'-vframes', '1',
											'-y',
											posterImagePath
										]);
									
										process3.on('spawn', function (code) {
											logDebugMessageToConsole('live poster generating ffmpeg process spawned', null, null, true);
										});
										
										process3.on('exit', function (code) {
											logDebugMessageToConsole('live poster generating ffmpeg process exited with exit code: ' + code, null, null, true);
											
											if(code === 0) {
												const posterPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/poster.jpg');
												
												if(fs.existsSync(posterPath)) {
													logDebugMessageToConsole('generated live poster for video: ' + videoId, null, null, true);
													
													logDebugMessageToConsole('uploading live poster to node for video: ' + videoId, null, null, true);
													
													node_setPoster_fileSystem(jwtToken, videoId, posterPath)
													.then(nodeResponseData => {
														if(nodeResponseData.isError) {
															logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
														}
														else {
															logDebugMessageToConsole('uploaded live poster to node for video: ' + videoId, null, null, true);
															
															//fs.unlinkSync(posterPath);
														}
													})
													.catch(error => {
														logDebugMessageToConsole(null, error, new Error().stack, true);
													});
												} else {
													logDebugMessageToConsole('expected a live poster to be generated in <' + posterPath + '> but found none', null, null, true);
												}
											}
											else {
												logDebugMessageToConsole('live poster generating exited with code: ' + code, null, null, true);
											}
										});
										
										process3.on('error', function (code) {
											logDebugMessageToConsole('live poster generating errorred with error code: ' + code, null, null, true);
										});
										
										
										
										
										
										const directoryPaths = [
											{fileName : manifestFileName, filePath: manifestFilePath}, 
											{fileName : expectedSegmentFileName, filePath: expectedSegmentFilePath}
										];
										
										node_uploadStream_fileSystem(jwtToken, videoId, 'm3u8', resolution, directoryPaths)
										.then(nodeResponseData => {
											if(nodeResponseData.isError) {
												logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
											}
											else {
												if(isRecordingStreamLocally) {
													const inputStream = fs.createReadStream(expectedSegmentFilePath);
													const outputStream = fs.createWriteStream(sourceFilePath, {flags: 'a'});
													
													outputStream.on('close', function() {
														//fs.unlinkSync(expectedSegmentFilePath);
													});

													inputStream.on('error', error => {
														logDebugMessageToConsole(null, error, new Error().stack, true);
													});

													inputStream.pipe(outputStream)
													.on('error', error => {
														logDebugMessageToConsole(null, error, new Error().stack, true);
													});
												}
											}
										})
										.catch(error => {
											logDebugMessageToConsole(null, error, new Error().stack, true);
										});
										
										node_getVideoBandwidth_database(jwtToken, videoId)
										.then(nodeResponseData => {
											if(nodeResponseData.isError) {
												logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
											}
											else {
												const bandwidth = nodeResponseData.bandwidth;
												
												node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: {type: 'streaming', videoId: videoId, lengthTimestamp: lengthTimestamp, bandwidth: bandwidth}}});
											}
										})
										.catch(error => {
											logDebugMessageToConsole(null, error, new Error().stack, true);
										});
										
										if(!isRecordingStreamRemotely) {
											const segmentIndexToRemove = nextExpectedSegmentIndex - 20;
											
											if(segmentIndexToRemove >= 0) {
												const segmentName = 'segment-' + resolution + '-' + segmentIndexToRemove + '.ts';
												
												node_removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName)
												.then(nodeResponseData => {
													if(nodeResponseData.isError) {
														logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
													}
													else {
														logDebugMessageToConsole('segment removed: ' + segmentName, null, null, true);
													}
												})
												.catch(error => {
													logDebugMessageToConsole(null, error, new Error().stack, true);
												});
											}
										}
									}
								}
							})
							.catch(error => {
								logDebugMessageToConsole(null, error, new Error().stack, true);
							});
						})();
					}
					else {
						if(segmentInterval != null) {
							clearInterval(segmentInterval);
						}
					}
				}, 1000);
			});
			
			process.on('exit', function (code) {
				logDebugMessageToConsole('performStreamingJob live stream process exited with exit code: ' + code, null, null, true);
				
				if(segmentInterval != null) {
					clearInterval(segmentInterval);
				}
				
				if(publishStreamTracker.hasOwnProperty(videoId)) {
					logDebugMessageToConsole('performStreamingJob checking if live stream process was interrupted by user...', null, null, true);
					
					if(!publishStreamTracker[videoId].stopping) {
						logDebugMessageToConsole('performStreamingJob determined live stream process was interrupted by user', null, null, true);
						
						node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopping', videoId: videoId }}});
						
						node_stopVideoStreaming_database(jwtToken, videoId)
						.then((nodeResponseData) => {
							if(nodeResponseData.isError) {
								logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							}
							else {
								node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'streaming_stopped', videoId: videoId }}});
							}
						})
						.catch(error => {
							logDebugMessageToConsole(null, error, new Error().stack, true);
						});
					}
					else {
						logDebugMessageToConsole('performStreamingJob determined live stream process was interrupted by user', null, null, true);
					}
				}
			});
			
			process.on('error', function (code) {
				logDebugMessageToConsole('performEncodingJob errored with error code: ' + code, null, null, true);
				
				if(segmentInterval != null) {
					clearInterval(segmentInterval);
				}
			});
			
			resolve({isError: false});
		});
	}
}

function getClientSettings() {
	const clientSettings = JSON.parse(fs.readFileSync(path.join(USER_DIRECTORY, '_client_settings.json'), 'utf8'));

	return clientSettings;
}

function setClientSettings(clientSettings) {
	fs.writeFileSync(path.join(USER_DIRECTORY, '_client_settings.json'), JSON.stringify(clientSettings));
}

function loadConfig() {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

	sharp.cache(false);

	const config = JSON.parse(fs.readFileSync(path.join(__dirname, '/config.json'), 'utf8'));

	setMoarTubeClientPort(config.clientConfig.port);
	setPublicDirectoryPath(path.join(__dirname, 'public'));

	if(global != null && global.electronPaths != null) {
		setUserDirectoryPath(path.join(global.electronPaths.userData, 'user'));
		setTempDirectoryPath(path.join(global.electronPaths.temp, 'moartube-client/temp'));
	}
	else {
		setUserDirectoryPath(path.join(__dirname, 'user'));
		setTempDirectoryPath(path.join(__dirname, 'temp'));
	}
	
	setTempCertificatesDirectoryPath(path.join(getTempDirectoryPath(), 'certificates'));
	setTempVideosDirectoryPath(path.join(getTempDirectoryPath(), 'media/videos'));
}