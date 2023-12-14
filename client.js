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
	
	if (!fs.existsSync(USER_DIRECTORY)) {
		fs.mkdirSync(USER_DIRECTORY, { recursive: true });
	}

	if (!fs.existsSync(TEMP_CERTIFICATES_DIRECTORY)) {
		fs.mkdirSync(TEMP_CERTIFICATES_DIRECTORY, { recursive: true });
	}

	if (!fs.existsSync(TEMP_VIDEOS_DIRECTORY)) {
		fs.mkdirSync(TEMP_VIDEOS_DIRECTORY, { recursive: true });
	}

	if (!fs.existsSync(path.join(USER_DIRECTORY, '_client_settings.json'))) {
		fs.writeFileSync(path.join(USER_DIRECTORY, '_client_settings.json'), JSON.stringify({
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
	
	const pendingPublishingJobs = [];
	const importVideoTracker = {};
	const publishVideoEncodingTracker = {};
	const publishStreamTracker = {};
	
	const app = express();
	
	app.enable('trust proxy');
	
	app.use('/javascript', express.static(path.join(PUBLIC_DIRECTORY, 'javascript')));
	app.use('/css', express.static(path.join(PUBLIC_DIRECTORY, 'css')));
	app.use('/images', express.static(path.join(PUBLIC_DIRECTORY, 'images')));
	app.use('/fonts', express.static(path.join(PUBLIC_DIRECTORY, 'fonts')));
	
	const sessionMiddleware = expressSession({
		name: crypto.randomBytes(64).toString('hex'),
		secret: crypto.randomBytes(64).toString('hex'),
		resave: false,
		saveUninitialized: true
	});
	app.use(sessionMiddleware);
	
	app.use(bodyParser.urlencoded({ extended: false }));
	app.use(bodyParser.json());
	
	const httpServer = http.createServer(app);

	httpServer.requestTimeout = 0; // needed for long duration requests (streaming, large uploads)

	var websocketServer;
	var websocketClient;
	
	httpServer.listen(MOARTUBE_CLIENT_PORT, function() {
		logDebugMessageToConsole('MoarTube Client is listening on port ' + MOARTUBE_CLIENT_PORT, null, null, true);
		
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
	
	// Serve the home page
	app.get('/', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send('error communicating with the MoarTube node');
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getSettings_filesystem(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send('error communicating with the MoarTube node');
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
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
					res.redirect('/signin');
				}
			}
		});
	});
	
	app.get('/node/information', (req, res) => {
		const nodeInformation = {
			publicNodeProtocol: MOARTUBE_NODE_HTTP_PROTOCOL,
			publicNodeAddress: MOARTUBE_NODE_IP,
			publicNodePort: MOARTUBE_NODE_PORT
		};
							
		res.send({isError: false, nodeInformation: nodeInformation});
	});
	
	// Serve the signin page
	app.get('/signin', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send('error communicating with the MoarTube node');
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getSettings_filesystem(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send('error communicating with the MoarTube node');
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
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
					const pagePath = path.join(PUBLIC_DIRECTORY, 'pages/signin.html');
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
	});
	
	app.post('/signin', (req, res) => {
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
			
			node_getHeartbeat_1('http', moarTubeNodeIp, moarTubeNodePort)
			.then((nodeResponseData) => {
				logDebugMessageToConsole('user signing in with HTTP available', null, null, true);
				
				performSignIn('http', 'ws', moarTubeNodeIp, moarTubeNodePort);
			})
			.catch(error => {
				logDebugMessageToConsole('attempting user sign in with HTTPS...', null, null, true);
				
				node_getHeartbeat_1('https', moarTubeNodeIp, moarTubeNodePort)
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
				MOARTUBE_NODE_HTTP_PROTOCOL = moarTubeNodeProtocol
				MOARTUBE_NODE_WEBSOCKET_PROTOCOL = moarTubeNodeWebsocketProtocol;
				
				MOARTUBE_NODE_IP = moarTubeNodeIp;
				MOARTUBE_NODE_PORT = moarTubeNodePort;
				
				node_doSignin(username, password, rememberMe)
				.then((nodeResponseData) => {
					if(nodeResponseData.isError) {
						logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
						
						res.send({isError: true, message: 'error communicating with the MoarTube node'});
					}
					else {
						if(nodeResponseData.isAuthenticated) {
							req.session.jwtToken = nodeResponseData.token;
							
							if(websocketClient != null) {
								websocketClient.canReconnect = false;
								
								websocketClient.close();
							}

							var connectWebsocketClient = function() {
								try {
									const websocketServerAddress = MOARTUBE_NODE_WEBSOCKET_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT;
									
									websocketClient = new webSocket(websocketServerAddress);
									websocketClient.canReconnect = true;
									
									var pingIntervalTimer;
									var pingTimeoutTimer;

									websocketClient.on('open', () => {
										logDebugMessageToConsole('MoarTube Client websocket connected to node: ' + websocketServerAddress, null, null, true);
										
										websocketClient.send(JSON.stringify({eventName: 'register', socketType: 'moartube_client', jwtToken: req.session.jwtToken}));

										pingIntervalTimer = setInterval(function() {
											if(pingTimeoutTimer == null) {
												pingTimeoutTimer = setTimeout(function() {
													logDebugMessageToConsole('terminating likely dead MoarTube Client websocket connection to node: ' + websocketServerAddress, null, null, true);

													clearInterval(pingIntervalTimer);
													websocketClient.terminate();
												}, 3000);

												//logDebugMessageToConsole('sending ping to node: ' + websocketServerAddress, null, null, true);
												
												websocketClient.send(JSON.stringify({eventName: 'ping', jwtToken: req.session.jwtToken}));
											}
										}, 1000);
									});
									
									websocketClient.on('message', (message) => {
										const parsedMessage = JSON.parse(message);
										
										if(parsedMessage.eventName === 'pong') {
											//logDebugMessageToConsole('received pong from node: ' + websocketServerAddress, null, null, true);

											clearTimeout(pingTimeoutTimer);
											pingTimeoutTimer = null;
										}
										else if(parsedMessage.eventName === 'registered') {
											logDebugMessageToConsole('MoarTube Client registered websocket with node: ' + websocketServerAddress, null, null, true);
										}
										else if(parsedMessage.eventName === 'echo') {
											if(parsedMessage.data.eventName === 'video_status') {
												if(parsedMessage.data.payload.type === 'importing_stopping') {
													if(importVideoTracker.hasOwnProperty(parsedMessage.data.payload.videoId)) {
														importVideoTracker[parsedMessage.data.payload.videoId].stopping = true;
													}
												}
												else if(parsedMessage.data.payload.type === 'importing_stopped') {
													if(importVideoTracker.hasOwnProperty(parsedMessage.data.payload.videoId)) {
														importVideoTracker[parsedMessage.data.payload.videoId].req.destroy();
														
														//delete importVideoTracker[parsedMessage.data.payload.videoId];
													}
													
													websocketServerBroadcast(parsedMessage.data);
												}
												else if(parsedMessage.data.payload.type === 'publishing_stopping') {
													if(publishVideoEncodingTracker.hasOwnProperty(parsedMessage.data.payload.videoId)) {
														publishVideoEncodingTracker[parsedMessage.data.payload.videoId].stopping = true;
													}
												}
												else if(parsedMessage.data.payload.type === 'publishing_stopped') {
													if(publishVideoEncodingTracker.hasOwnProperty(parsedMessage.data.payload.videoId)) {
														const processes = publishVideoEncodingTracker[parsedMessage.data.payload.videoId].processes;
														processes.forEach(function(process) {
															process.kill(); // no point in being graceful about it; just kill it
														});
														
														//delete publishVideoEncodingTracker[parsedMessage.data.payload.videoId];
													}
													
													websocketServerBroadcast(parsedMessage.data);
												}
												else if(parsedMessage.data.payload.type === 'streaming_stopping') {
													if(publishStreamTracker.hasOwnProperty(parsedMessage.data.payload.videoId)) {
														publishStreamTracker[parsedMessage.data.payload.videoId].stopping = true;
													}
												}
												else if(parsedMessage.data.payload.type === 'streaming_stopped') {
													if(publishStreamTracker.hasOwnProperty(parsedMessage.data.payload.videoId)) {
														const process = publishStreamTracker[parsedMessage.data.payload.videoId].process;
														process.kill(); // no point in being graceful about it; just kill it
														
														//delete publishStreamTracker[parsedMessage.data.payload.videoId];
													}
													
													websocketServerBroadcast(parsedMessage.data);
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
										logDebugMessageToConsole('MoarTube Client websocket disconnected from node <' + websocketServerAddress + '>', null, null, true);

										clearInterval(pingIntervalTimer);
										clearInterval(pingTimeoutTimer);
										
										if(websocketClient.canReconnect) {
											setTimeout(connectWebsocketClient, 1000);
										}
									});
								}
								catch(error) {
									logDebugMessageToConsole(null, error, new Error().stack, true);
								}
							};
							
							connectWebsocketClient();
							
							node_getSettings_filesystem(req.session.jwtToken)
							.then(nodeResponseData => {
								if(nodeResponseData.isError) {
									logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
									
									res.send({isError: true, message: 'error communicating with the MoarTube node'});
								}
								else {
									const nodeSettings = nodeResponseData.nodeSettings;
									
									if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
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
	});
	
	app.get('/account/signout', (req, res) => {
		logDebugMessageToConsole('signing user out', null, null, true);
		
		signUserOut(req, res);
	});
	
	
	
	
	// Serve the configure page
	app.get('/configure', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				signUserOut(req, res);
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getSettings_filesystem(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							signUserOut(req, res);
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
								res.redirect('/settings');
							}
							else {
								const pagePath = path.join(PUBLIC_DIRECTORY, 'pages/configure.html');
								const fileStream = fs.createReadStream(pagePath);
								res.setHeader('Content-Type', 'text/html');
								fileStream.pipe(res);
							}
						}
					})
					.catch(error => {
						logDebugMessageToConsole(null, error, new Error().stack, true);
						
						signUserOut(req, res);
					});
				}
				else {
					res.redirect('/signin');
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			signUserOut(req, res);
		});
	});
	
	app.post('/configure/skip', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_setConfigurationSkipped(jwtToken)
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
	
	
	// Serve the videos page
	app.get('/videos', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				signUserOut(req, res);
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getSettings_filesystem(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							signUserOut(req, res);
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
								const pagePath = path.join(PUBLIC_DIRECTORY, 'pages/videos.html');
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
					res.redirect('/signin');
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			signUserOut(req, res);
		});
	});
	
	// Serve the comments page
	app.get('/comments', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				signUserOut(req, res);
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getSettings_filesystem(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							signUserOut(req, res);
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
								const pagePath = path.join(PUBLIC_DIRECTORY, 'pages/comments.html');
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
					res.redirect('/signin');
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			signUserOut(req, res);
		});
	});
	
	app.post('/video/import', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then((nodeResponseData) => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					logDebugMessageToConsole('attempting to import video file into the client file system', null, null, true);
					
					const totalFileSize = parseInt(req.headers['content-length']);
					
					if(totalFileSize > 0) {
						logDebugMessageToConsole('importing video into the client file system: ' + totalFileSize + ' bytes', null, null, true);
						
						const title = req.query.title;
						const description = req.query.description;
						const tags = req.query.tags;
						
						logDebugMessageToConsole('requesting video id for imported video....', null, null, true);

						node_importVideo_database(jwtToken, title, description, tags)
						.then(nodeResponseData => {
							if(nodeResponseData.isError) {
								logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
								
								res.send({isError: true, message: 'error communicating with the MoarTube node'});
							}
							else {
								const videoId = nodeResponseData.videoId;
								
								logDebugMessageToConsole('imported video file assigned video id: ' + videoId, null, null, true);
								
								importVideoTracker[videoId] = {req: req, stopping: false};
								
								var lastImportingTime = 0;
								var receivedFileSize = 0;
								req.on('data', function(chunk) {
									if(!importVideoTracker[videoId].stopping) {
										receivedFileSize += chunk.length;
										
										const importProgress = Math.floor((receivedFileSize / totalFileSize) * 100);
										
										const currentTime = Date.now();
										
										if(currentTime - lastImportingTime >= 100) {
											lastImportingTime = currentTime;
											
											node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing', videoId: videoId, progress: importProgress }}});
										}
									}
								});
								
								multer({
									storage: multer.diskStorage({
										destination: function (req, file, cb) {
											const sourceDirectoryPath =  path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/source');
											
											fs.mkdirSync(sourceDirectoryPath, { recursive: true });
											
											fs.access(sourceDirectoryPath, fs.F_OK, function(error) {
												if(error) {
													cb(new Error('file upload error'));
												}
												else {
													cb(null, sourceDirectoryPath);
												}
											});
										},
										filename: function (req, file, cb) {
											var extension;
											
											if(file.mimetype === 'video/mp4') {
												extension = '.mp4';
											}
											else if(file.mimetype === 'video/webm') {
												extension = '.webm';
											}
											
											const fileName = videoId + extension;
											
											logDebugMessageToConsole('imported video file and assigned temporary file name: ' + fileName, null, null, true);
											
											cb(null, fileName);
										}
									})
								}).fields([{ name: 'video_file', minCount: 1, maxCount: 1 }])
								(req, res, function(error) {
									if(error) {
										logDebugMessageToConsole(nodeResponseData.message, error, new Error().stack, true);
										
										node_setVideoError_database(jwtToken, videoId)
										.then(nodeResponseData => {
											if(nodeResponseData.isError) {
												logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
												
												res.send({isError: true, message: 'error communicating with the MoarTube node'});
											}
											else {
												res.send({isError: true, message: 'error communicating with the MoarTube node'});
											}
										})
										.catch(error => {
											logDebugMessageToConsole(null, error, new Error().stack, true);
											
											res.send({isError: true, message: 'error communicating with the MoarTube node'});
										});
									}
									else {
										const videoFile = req.files['video_file'][0];
										const videoFilePath = videoFile.path;
										
										var sourceFileExtension = '';
										if(videoFile.mimetype === 'video/mp4') {
											sourceFileExtension = '.mp4';
										}
										else if(videoFile.mimetype === 'video/webm') {
											sourceFileExtension = '.webm';
										}
										
										node_setSourceFileExtension_database(jwtToken, videoId, sourceFileExtension)
										.then(nodeResponseData => {
											if(nodeResponseData.isError) {
												logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
												
												res.send({isError: true, message: 'error communicating with the MoarTube node'});
											}
											else {
												const result = spawnSync(ffmpegPath, [
													'-i', videoFilePath
												], 
												{encoding: 'utf-8' }
												);
												
												const durationIndex = result.stderr.indexOf('Duration: ');
												const lengthTimestamp = result.stderr.substr(durationIndex + 10, 11);
												const lengthSeconds = timestampToSeconds(lengthTimestamp);
												
												logDebugMessageToConsole('generating images for video: ' + videoId, null, null, true);
												
												const imagesDirectoryPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images');
												const sourceImagePath = path.join(imagesDirectoryPath, 'source.jpg');
												const thumbnailImagePath = path.join(imagesDirectoryPath, 'thumbnail.jpg');
												const previewImagePath = path.join(imagesDirectoryPath, 'preview.jpg');
												const posterImagePath = path.join(imagesDirectoryPath, 'poster.jpg');
												
												fs.mkdirSync(imagesDirectoryPath, { recursive: true });
												
												const imageExtractionTimestamp = Math.floor(lengthSeconds * 0.25);
												
												spawnSync(ffmpegPath, ['-ss', imageExtractionTimestamp, '-i', videoFilePath, sourceImagePath]);
												
												sharp(sourceImagePath).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toFile(thumbnailImagePath)
												.then(() => {
													sharp(sourceImagePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toFile(previewImagePath)
													.then(() => {
														sharp(sourceImagePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toFile(posterImagePath)
														.then(() => {
															if(!fs.existsSync(thumbnailImagePath)) {
																logDebugMessageToConsole('expected a thumbnail to be generated in <' + thumbnailImagePath + '> but found none', null, new Error().stack, true);
																
																res.send({isError: true, message: 'error communicating with the MoarTube node'});
															}
															else if(!fs.existsSync(previewImagePath)) {
																logDebugMessageToConsole('expected a preview to be generated in <' + previewImagePath + '> but found none', null, new Error().stack, true);
																
																res.send({isError: true, message: 'error communicating with the MoarTube node'});
															}
															else if(!fs.existsSync(posterImagePath)) {
																logDebugMessageToConsole('expected a poster to be generated in <' + posterImagePath + '> but found none', null, new Error().stack, true);
																
																res.send({isError: true, message: 'error communicating with the MoarTube node'});
															}
															else {
																logDebugMessageToConsole('generated thumbnail, preview, and poster for video: ' + videoId, null, null, true);
																
																logDebugMessageToConsole('uploading thumbnail, preview, and poster to node for video: ' + videoId, null, null, true);
																
																node_setThumbnail_fileSystem(jwtToken, videoId, thumbnailImagePath)
																.then(nodeResponseData => {
																	if(nodeResponseData.isError) {
																		logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
																		
																		res.send({isError: true, message: 'error communicating with the MoarTube node'});
																	}
																	else {
																		logDebugMessageToConsole('uploaded thumbnail to node for video: ' + videoId, null, null, true);
																		
																		node_setPreview_fileSystem(jwtToken, videoId, previewImagePath)
																		.then(nodeResponseData => {
																			if(nodeResponseData.isError) {
																				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
																				
																				res.send({isError: true, message: 'error communicating with the MoarTube node'});
																			}
																			else {
																				logDebugMessageToConsole('uploaded preview to node for video: ' + videoId, null, null, true);
																				
																				node_setPoster_fileSystem(jwtToken, videoId, posterImagePath)
																				.then(nodeResponseData => {
																					if(nodeResponseData.isError) {
																						logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
																						
																						res.send({isError: true, message: 'error communicating with the MoarTube node'});
																					}
																					else {
																						logDebugMessageToConsole('uploaded poster to node for video: ' + videoId, null, null, true);
																						
																						deleteDirectoryRecursive(imagesDirectoryPath);
																						
																						logDebugMessageToConsole('uploading video length to node for video: ' + videoId, null, null, true);
																						
																						node_setVideoLengths_database(jwtToken, videoId, lengthSeconds, lengthTimestamp)
																						.then(nodeResponseData => {
																							if(nodeResponseData.isError) {
																								logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
																								
																								res.send({isError: true, message: 'error communicating with the MoarTube node'});
																							}
																							else {
																								logDebugMessageToConsole('uploaded video length to node for video: ' + videoId, null, null, true);
																								
																								node_setVideoImported_database(jwtToken, videoId)
																								.then(nodeResponseData => {
																									if(nodeResponseData.isError) {
																										logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
																										
																										res.send({isError: true, message: 'error communicating with the MoarTube node'});
																									}
																									else {
																										logDebugMessageToConsole('flagging video as imported to node for video: ' + videoId, null, null, true);
																										
																										node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'imported', videoId: videoId, lengthTimestamp: lengthTimestamp }}});
																										
																										res.send({isError: false});
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
										})
										.catch(error => {
											logDebugMessageToConsole(null, error, new Error().stack, true);
											
											res.send({isError: true, message: 'error communicating with the MoarTube node'});
										});
									}
								});
							}
						})
						.catch(error => {
							logDebugMessageToConsole(null, error, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						});
					}
					else {
						logDebugMessageToConsole('expected totalFileSize of non-zero but got zero', null, null, true);
						
						res.send({isError: true, message: 'error communicating with the MoarTube node'});
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
	
	app.post('/videos/:videoId/importing/stop', (req, res) => {
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
					
					node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing_stopping', videoId: videoId }}});
					
					node_stopVideoImporting_database(jwtToken, videoId)
					.then((nodeResponseData) => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'importing_stopped', videoId: videoId }}});
							
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
	
	app.post('/videos/:videoId/publish', (req, res) => {
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
					const publishings = JSON.parse(req.body.publishings);
					
					node_getVideoInformation_database(jwtToken, videoId)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const isLive = nodeResponseData.information.isLive;
							const isStreaming = nodeResponseData.information.isStreaming;
							const isFinalized = nodeResponseData.information.isFinalized;
							
							if(isLive && isStreaming) {
								res.send({isError: true, message: 'this video is currently streaming'});
							}
							else if(isFinalized) {
								res.send({isError: true, message: 'this video was finalized; no further publishings are possible'});
							}
							else {
								node_getSourceFileExtension_database(jwtToken, videoId)
								.then(nodeResponseData => {
									if(nodeResponseData.isError) {
										logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
										
										res.send({isError: true, message: nodeResponseData.message});
									}
									else {
										const sourceFileExtension = nodeResponseData.sourceFileExtension;
										
										const sourceFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/source/' + videoId + sourceFileExtension);

										if(fs.existsSync(sourceFilePath)) {
											for(const publishing of publishings) {
												const format = publishing.format;
												const resolution = publishing.resolution;

												pendingPublishingJobs.push({
													jwtToken: jwtToken,
													videoId: videoId,
													format: format,
													resolution: resolution,
													sourceFileExtension: sourceFileExtension,
													idleInterval: setInterval(function() {
														node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing', videoId: videoId, format: format, resolution: resolution, progress: 0 }}});
													}, 1000)
												});
											}
											
											res.send({isError: false});
										}
										else {
											if(isLive) {
												res.send({isError: true, message: 'a recording of this stream does not exist'});
											}
											else {
												res.send({isError: true, message: 'a source for this video does not exist'});
											}
										}
									}
								});
							}
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
	
	app.post('/videos/:videoId/unpublish', (req, res) => {
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
					const format = req.body.format;
					const resolution = req.body.resolution;
					
					node_getVideoData_database(jwtToken, videoId)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const videoData = nodeResponseData.videoData;
							
							node_unpublishVideo_filesystem(jwtToken, videoId, format, resolution)
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
	
	app.post('/videos/:videoId/publishing/stop', (req, res) => {
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
					
					node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing_stopping', videoId: videoId }}});
					
					node_stopVideoPublishing_database(jwtToken, videoId)
					.then((nodeResponseData) => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing_stopped', videoId: videoId }}});
					
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
	
	app.post('/stream/start', (req, res) => {
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
									
									node_streamVideo_database(jwtToken, title, description, tags, rtmpPort, uuid, isRecordingStreamRemotely, isRecordingStreamLocally)
									.then(nodeResponseData => {
										if(nodeResponseData.isError) {
											logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
											
											res.send({isError: true, message: 'error communicating with the MoarTube node'});
										}
										else {
											const videoId = nodeResponseData.videoId;
											
											publishStreamTracker[videoId] = {process: null, stopping: false};
											
											node_setSourceFileExtension_database(jwtToken, videoId, '.ts')
											.then(nodeResponseData => {
												if(nodeResponseData.isError) {
													logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
													
													res.send({isError: true, message: 'error communicating with the MoarTube node'});
												}
												else {
													const rtmpUrl = 'rtmp://127.0.0.1:' + rtmpPort + '/live/' + uuid;
													
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
	
	app.post('/videos/:videoId/streaming/stop', (req, res) => {
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
					
					node_stopVideoStreaming_database(jwtToken, videoId)
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
	
	app.get('/videos/search', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const searchTerm = req.query.searchTerm;
					const sortTerm = req.query.sortTerm;
					const tagTerm = req.query.tagTerm;
					const tagLimit = req.query.tagLimit;
					const timestamp = req.query.timestamp;
					
					node_doVideosSearch_database(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							res.send({isError: false, searchResults: nodeResponseData.searchResults});
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
	
	app.get('/channel/search', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const searchTerm = req.query.searchTerm;
					const sortTerm = req.query.sortTerm;
					const tagTerm = req.query.tagTerm;
					const tagLimit = req.query.tagLimit;
					const timestamp = req.query.timestamp;
					
					node_doVideosSearchAll_database(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							res.send({isError: false, searchResults: nodeResponseData.searchResults});
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
	
	app.get('/videos/:videoId/thumbnail', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.end();
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const videoId = req.params.videoId;
					
					node_getThumbnail_fileSystem(jwtToken, videoId)
					.then(nodeResponseData => {
						res.setHeader('Content-Type', 'image/jpeg');
						nodeResponseData.pipe(res);
					})
					.catch(error => {
						logDebugMessageToConsole(null, error, new Error().stack, true);
						
						res.status(404).send('thumbnail not found');
					});
				}
				else {
					res.status(404).send('thumbnail not found');
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			res.status(404).send('thumbnail not found');
		});
	});
	
	app.get('/videos/:videoId/preview', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.end();
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const videoId = req.params.videoId;
					
					node_getPreview_fileSystem(jwtToken, videoId)
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
					res.end();
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			res.end();
		});
	});
	
	app.get('/videos/:videoId/poster', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.end();
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const videoId = req.params.videoId;
					
					node_getPoster_fileSystem(jwtToken, videoId)
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
					res.end();
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			res.end();
		});
	});
	
	app.post('/videos/:videoId/thumbnail', (req, res) => {
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
					
					multer({
						storage: multer.diskStorage({
							destination: function (req, file, cb) {
								const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images');
								
								fs.mkdirSync(filePath, { recursive: true });
								
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
								
								if(file.mimetype === 'image/jpeg') {
									extension = '.jpg';
								}
								
								const fileName = Date.now() + extension;
								
								cb(null, fileName);
							}
						})
					}).fields([{ name: 'thumbnail_file', minCount: 1, maxCount: 1 }])
					(req, res, function(error) {
						if(error) {
							logDebugMessageToConsole(null, error, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const thumbnailFile = req.files['thumbnail_file'][0];
						
							const sourceFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/' + thumbnailFile.filename);
							const destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/thumbnail.jpg');
							
							sharp(sourceFilePath).resize({width: 100}).resize(100, 100).jpeg({quality : 90}).toFile(destinationFilePath)
							.then(() => {
								node_setThumbnail_fileSystem(jwtToken, videoId, destinationFilePath)
								.then(nodeResponseData => {
									if(nodeResponseData.isError) {
										logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
										
										res.send({isError: true, message: 'error communicating with the MoarTube node'});
									}
									else {
										logDebugMessageToConsole('uploaded live preview to node for video: ' + videoId, null, null, true);
										
										fs.unlinkSync(destinationFilePath);
										
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
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			res.send({isError: true, message: 'error communicating with the MoarTube node'});
		});
	});
	
	app.post('/videos/:videoId/preview', (req, res) => {
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
					
					multer({
						storage: multer.diskStorage({
							destination: function (req, file, cb) {
								const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images');
								
								fs.mkdirSync(filePath, { recursive: true });
								
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
								
								if(file.mimetype === 'image/jpeg') {
									extension = '.jpg';
								}
								
								const fileName = Date.now() + extension;
								
								cb(null, fileName);
							}
						})
					}).fields([{ name: 'preview_file', minCount: 1, maxCount: 1 }])
					(req, res, function(error) {
						if(error) {
							logDebugMessageToConsole(null, error, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const previewFile = req.files['preview_file'][0];
						
							const sourceFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/' + previewFile.filename);
							const destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/preview.jpg');
							
							sharp(sourceFilePath).resize({width: 512}).resize(512, 288).jpeg({quality : 90}).toFile(destinationFilePath)
							.then(() => {
								node_setPreview_fileSystem(jwtToken, videoId, destinationFilePath)
								.then(nodeResponseData => {
									if(nodeResponseData.isError) {
										logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
										
										res.send({isError: true, message: 'error communicating with the MoarTube node'});
									}
									else {
										logDebugMessageToConsole('uploaded live preview to node for video: ' + videoId, null, null, true);
										
										fs.unlinkSync(destinationFilePath);
										
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
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			res.send({isError: true, message: 'error communicating with the MoarTube node'});
		});
	});
	
	app.post('/videos/:videoId/poster', (req, res) => {
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
					
					multer({
						storage: multer.diskStorage({
							destination: function (req, file, cb) {
								const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images');
								
								fs.mkdirSync(filePath, { recursive: true });
								
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
								
								if(file.mimetype === 'image/jpeg') {
									extension = '.jpg';
								}
								
								const fileName = Date.now() + extension;
								
								cb(null, fileName);
							}
						})
					}).fields([{ name: 'poster_file', minCount: 1, maxCount: 1 }])
					(req, res, function(error) {
						if(error) {
							logDebugMessageToConsole(null, error, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const posterFile = req.files['poster_file'][0];
						
							const sourceFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/' + posterFile.filename);
							const destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/images/poster.jpg');
							
							sharp(sourceFilePath).resize({width: 1280}).resize(1280, 720).jpeg({quality : 90}).toFile(destinationFilePath)
							.then(() => {
								node_setPoster_fileSystem(jwtToken, videoId, destinationFilePath)
								.then(nodeResponseData => {
									if(nodeResponseData.isError) {
										logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
										
										res.send({isError: true, message: 'error communicating with the MoarTube node'});
									}
									else {
										logDebugMessageToConsole('uploaded live poster to node for video: ' + videoId, null, null, true);
										
										fs.unlinkSync(destinationFilePath);
										
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
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			res.send({isError: true, message: 'error communicating with the MoarTube node'});
		});
	});
	
	app.get('/videos/tags', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getVideosTags_database(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							res.send({isError: false, tags: nodeResponseData.tags});
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
	
	app.get('/videos/tags/all', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getVideosTagsAll_database(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							res.send({isError: false, tags: nodeResponseData.tags});
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
	
	app.get('/videos/busy', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getBusyVideos(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const videos = nodeResponseData.videos;
							
							res.send({isError: false, videos: videos});
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
	
	
	
	
	
	
	
	
	
	
	
	
	
	// Serve the reports page for video reports
	app.get('/reports/videos', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				signUserOut(req, res);
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getSettings_filesystem(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							signUserOut(req, res);
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
								const pagePath = path.join(PUBLIC_DIRECTORY, 'pages/reports-videos.html');
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
					res.redirect('/signin');
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			signUserOut(req, res);
		});
	});
	
	app.get('/reports/videos/all', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getVideoReports(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const reports = nodeResponseData.reports;
							
							res.send({isError: false, reports: reports});
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
	
	app.get('/reports/videos/archive/all', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getVideoReportsArchive(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const reports = nodeResponseData.reports;
							
							res.send({isError: false, reports: reports});
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
	
	app.post('/reports/video/archive', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const reportId = req.body.reportId;
					
					node_archiveVideoReport(jwtToken, reportId)
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
	
	app.post('/reports/video/delete', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const reportId = req.body.reportId;
					
					node_removeVideoReport(jwtToken, reportId)
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
	
	app.post('/reports/archive/video/delete', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const archiveId = req.body.archiveId;
					
					node_removeVideoReportArchive(jwtToken, archiveId)
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
	
	app.get('/reports/count', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getReportCount(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const videoReportCount = nodeResponseData.videoReportCount;
							const commentReportCount = nodeResponseData.commentReportCount;
							const totalReportCount = nodeResponseData.totalReportCount;
							
							res.send({isError: false, videoReportCount: videoReportCount, commentReportCount: commentReportCount, totalReportCount: totalReportCount});
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
	
	app.get('/videos/comments/all', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getAllComments(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send('error communicating with the MoarTube node');
						}
						else {
							const comments = nodeResponseData.comments;
							
							res.send({isError: false, comments: comments});
						}
					})
					.catch(error => {
						logDebugMessageToConsole(null, error, new Error().stack, true);
						
						res.send('error communicating with the MoarTube node');
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
	
	
	
	
	
	// Serve the reports page for comment reports
	app.get('/reports/comments', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				signUserOut(req, res);
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getSettings_filesystem(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							signUserOut(req, res);
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
								const pagePath = path.join(PUBLIC_DIRECTORY, 'pages/reports-comments.html');
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
					res.redirect('/signin');
				}
			}
		})
		.catch(error => {
			logDebugMessageToConsole(null, error, new Error().stack, true);
			
			signUserOut(req, res);
		});
	});
	
	app.get('/reports/comments/all', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getCommentReports(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const reports = nodeResponseData.reports;
							
							res.send({isError: false, reports: reports});
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
	
	app.get('/reports/comments/archive/all', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getCommentReportsArchive(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							res.send({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							const reports = nodeResponseData.reports;
							
							res.send({isError: false, reports: reports});
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
	
	app.post('/reports/comment/archive', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const reportId = req.body.reportId;
					
					node_archiveCommentReport(jwtToken, reportId)
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
	
	app.post('/reports/comment/delete', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const reportId = req.body.reportId;
					
					node_removeCommentReport(jwtToken, reportId)
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
	
	app.post('/reports/archive/comment/delete', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const archiveId = req.body.archiveId;
					
					node_removeCommentReportArchive(jwtToken, archiveId)
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
	
	app.post('/comments/delete', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.send({isError: true, message: 'error communicating with the MoarTube node'});
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					const videoId = req.body.videoId;
					const commentId = req.body.commentId;
					const timestamp = req.body.timestamp;
					
					node_removeComment(jwtToken, videoId, commentId, timestamp)
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
					node_getSettings_filesystem(jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							signUserOut(req, res);
						}
						else {
							const nodeSettings = nodeResponseData.nodeSettings;
							
							if(nodeSettings.isNodeConfigured || nodeSettings.isNodeConfigurationSkipped) {
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
					res.redirect('/signin');
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
					node_getSettings_filesystem(jwtToken)
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
	
	app.get('/settings/node/avatar', (req, res) => {
		const jwtToken = req.session.jwtToken;
		
		node_isAuthenticated(jwtToken)
		.then(nodeResponseData => {
			if(nodeResponseData.isError) {
				logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
				
				res.end();
			}
			else {
				if(nodeResponseData.isAuthenticated) {
					node_getAvatar_fileSystem(jwtToken)
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
	
	app.post('/settings/node/network/external', (req, res) => {
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
					
					node_setNetworkExternal_filesystem(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort)
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
	
	app.get('/stream/:videoId/rtmp/urls', (req, res) => {
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
						
						const rtmpPort = meta.rtmpPort;
						const uuid = meta.uuid;
						
						const rtmpUrls = getRtmpStreamUrls(rtmpPort, uuid);
						
						res.send({isError: false, rtmpUrls: rtmpUrls});
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
	
	app.get('/stream/:videoId/chat/settings', (req, res) => {
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
	
	app.post('/stream/:videoId/chat/settings', (req, res) => {
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
	
	app.get('/heartbeat', (req, res) => {
		res.end();
	});
	
	
	
	
	/* axios calls */
	
	function node_isAuthenticated(jwtToken) {
		return new Promise(function(resolve, reject) {
			if(jwtToken == null || jwtToken === '') {
				resolve({isError: false, isAuthenticated: false});
			}
			else {
				axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/account/authenticated', {
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
			}
		});
	}
	
	function node_getHeartbeat_1(moarTubeNodeHttpProtocol, moarTubeNodeIp, moarTubeNodePort) {
		return new Promise(function(resolve, reject) {
			axios.get(moarTubeNodeHttpProtocol + '://' + moarTubeNodeIp + ':' + moarTubeNodePort + '/heartbeat')
			.then(response => {
				const data = response.data;
				
				resolve(data);
			})
			.catch(error => {
				reject(error);
			});
		});
	}
	
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
	
	function node_doSignin(username, password, rememberMe) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/account/signin', {
				username: username,
				password: password,
				rememberMe: rememberMe
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
	
	function node_streamVideo_database(jwtToken, title, description, tags, rtmpPort, uuid, isRecordingStreamRemotely, isRecordingStreamLocally) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/stream/start', {
				title: title,
				description: description,
				tags: tags,
				rtmpPort: rtmpPort,
				uuid: uuid,
				isRecordingStreamRemotely: isRecordingStreamRemotely,
				isRecordingStreamLocally: isRecordingStreamLocally
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
	
	function node_setSourceFileExtension_database(jwtToken, videoId, sourceFileExtension) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/sourceFileExtension', {
				sourceFileExtension: sourceFileExtension
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
	
	function node_getSourceFileExtension_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/sourceFileExtension', {
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
	
	function node_importVideo_database(jwtToken, title, description, tags) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/video/import', {
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
	
	function node_setVideoImported_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/video/imported', {
				videoId: videoId
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
	
	function node_setVideoPublishing_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/video/publishing', {
				videoId: videoId
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
	
	function node_setVideoPublished_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/video/published', {
				videoId: videoId
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
	
	function node_setVideoReady_fileSystem(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/video/ready', {
				videoId: videoId
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
	
	function node_setVideoError_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/video/error', {
				videoId: videoId
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
	
	function node_unpublishVideo_filesystem(jwtToken, videoId, format, resolution) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/unpublish', {
				format: format,
				resolution: resolution
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
	
	function node_doVideosSearch_database(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/search', {
			  params: {
				  searchTerm: searchTerm,
				  sortTerm: sortTerm,
				  tagTerm: tagTerm,
				  tagLimit: tagLimit,
				  timestamp: timestamp
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
	
	function node_doVideosSearchAll_database(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/channel/search', {
			  params: {
				  searchTerm: searchTerm,
				  sortTerm: sortTerm,
				  tagTerm: tagTerm,
				  tagLimit: tagLimit,
				  timestamp: timestamp
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
	
	function node_getVideoInformation_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/information', {
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
	
	function node_getVideosTags_database(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/tags', {
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
	
	function node_getVideosTagsAll_database(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/tags/all', {
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
	
	function node_setVideoLengths_database(jwtToken, videoId, lengthSeconds, lengthTimestamp) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/lengths', {
				lengthSeconds: lengthSeconds,
				lengthTimestamp: lengthTimestamp
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
	
	function node_getVideoData_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/data', {
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
	
	function node_stopVideoImporting_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/importing/stop', {
				videoId: videoId
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
	
	function node_stopVideoPublishing_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/publishing/stop', {
				videoId: videoId
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
	
	function node_stopVideoStreaming_database(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/streaming/stop', {
				videoId: videoId
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
	
	function node_getSettings_filesystem(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/node/settings', {
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
	
	
	function node_setThumbnail_fileSystem(jwtToken, videoId, thumbnailPath) {
		return new Promise(function(resolve, reject) {
			const thumbnailFileStream = fs.createReadStream(thumbnailPath);
			
			const formData = new FormData();
			formData.append('thumbnailFile', thumbnailFileStream, 'thumbnail.jpg');
			
			const headers = formData.getHeaders();
			headers.Authorization = jwtToken;
			
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/thumbnail', formData, {
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
	
	function node_setPreview_fileSystem(jwtToken, videoId, previewPath) {
		return new Promise(function(resolve, reject) {
			const previewFileStream = fs.createReadStream(previewPath);
			
			const formData = new FormData();
			formData.append('previewFile', previewFileStream, 'preview.jpg');
			
			const headers = formData.getHeaders();
			headers.Authorization = jwtToken;
			
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/preview', formData, {
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
	
	function node_setPoster_fileSystem(jwtToken, videoId, posterPath) {
		return new Promise(function(resolve, reject) {
			const posterFileStream = fs.createReadStream(posterPath);
			
			const formData = new FormData();
			formData.append('posterFile', posterFileStream, 'poster.jpg');
			
			const headers = formData.getHeaders();
			headers.Authorization = jwtToken;
			
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/poster', formData, {
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
	
	function node_getAvatar_fileSystem(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/avatar', {
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
	
	function node_setAvatar_fileSystem(jwtToken, iconPath, avatarPath) {
		return new Promise(function(resolve, reject) {
			const iconFileStream = fs.createReadStream(iconPath);
			const avatarFileStream = fs.createReadStream(avatarPath);
			
			const formData = new FormData();
			formData.append('iconFile', iconFileStream, 'icon.png');
			formData.append('avatarFile', avatarFileStream, 'avatar.png');
			
			const headers = formData.getHeaders();
			headers.Authorization = jwtToken;
			
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/avatar', formData, {
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
	
	function node_getThumbnail_fileSystem(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/thumbnail', {
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
	
	function node_getPreview_fileSystem(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/preview', {
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
	
	function node_getPoster_fileSystem(jwtToken, videoId) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/poster', {
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
	
	function node_setNetworkExternal_filesystem(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/settings/node/network/external', {
				publicNodeProtocol: publicNodeProtocol,
				publicNodeAddress: publicNodeAddress,
				publicNodePort: publicNodePort
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
	
	function node_setConfigurationSkipped(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/configure/skip', {}, {
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
	
	function node_getBusyVideos(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/busy', {
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
	
	function node_getVideoReportsArchive(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/node/reports/archive/videos', {
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
	
	function node_getReportCount(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/node/reports/count', {
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
	
	function node_archiveVideoReport(jwtToken, reportId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/reports/videos/archive', {
				reportId: reportId
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
	
	function node_removeVideoReport(jwtToken, reportId) {
		return new Promise(function(resolve, reject) {
			axios.delete(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/reports/videos/' + reportId + '/delete', {
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
	
	function node_getCommentReports(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/node/reports/comments', {
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
	
	function node_getCommentReportsArchive(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/node/reports/archive/comments', {
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
	
	function node_archiveCommentReport(jwtToken, reportId) {
		return new Promise(function(resolve, reject) {
			axios.post(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/reports/comments/archive', {
				reportId: reportId
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
	
	function node_removeCommentReport(jwtToken, reportId) {
		return new Promise(function(resolve, reject) {
			axios.delete(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/reports/comments/' + reportId + '/delete', {
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
	
	function node_removeVideoReportArchive(jwtToken, archiveId) {
		return new Promise(function(resolve, reject) {
			axios.delete(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/reports/archive/videos/' + archiveId + '/delete', {
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
	
	function node_removeCommentReportArchive(jwtToken, archiveId) {
		return new Promise(function(resolve, reject) {
			axios.delete(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/reports/archive/comments/' + archiveId + '/delete', {
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
	
	function node_removeComment(jwtToken, videoId, commentId, timestamp) {
		return new Promise(function(resolve, reject) {
			axios.delete(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/videos/' + videoId + '/comments/' + commentId + '/delete',  {
			  params: {
				  timestamp: timestamp
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
	
	function node_getAllComments(jwtToken) {
		return new Promise(function(resolve, reject) {
			axios.get(MOARTUBE_NODE_HTTP_PROTOCOL + '://' + MOARTUBE_NODE_IP + ':' + MOARTUBE_NODE_PORT + '/node/videos/comments/all', {
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
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	/* helper functions */

	function signUserOut(req, res) {
		req.session.jwtToken = '';
		
		if(websocketClient != null) {
			websocketClient.canReconnect = false;
			
			websocketClient.close();
		}
		
		res.redirect('/signin');
	}

	function isPublicNodeAddressValid(publicNodeAddress) {
		return publicNodeAddress != null && publicNodeAddress.length > 0 && publicNodeAddress.length <= 100;
	}
	
	function isPortValid(port) {
		port = Number(port);
		
		return port != null && port != NaN && (port >= 0 && port <= 65535);
	}

	function logDebugMessageToConsole(message, error, stackTrace, isLoggingToFile) {
		const date = new Date(Date.now());
		const year = date.getFullYear();
		const month = ('0' + (date.getMonth() + 1)).slice(-2);
		const day = ('0' + date.getDate()).slice(-2);
		const hours = ('0' + date.getHours()).slice(-2);
		const minutes = ('0' + date.getMinutes()).slice(-2);
		const seconds = ('0' + date.getSeconds()).slice(-2);
		const humanReadableTimestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

		if(message == null) {
			message = 'none';
		}
		
		var errorMessage = '<message: ' + message + ', date: ' + humanReadableTimestamp + '>';

		if(error != null) {
			if(typeof error === Error) {
				errorMessage += '\n' + error.message + '\n';
			}
			else {
				errorMessage += '\n' + error + '\n';
			}
		}

		if(stackTrace != null) {
			errorMessage += '\n' + stackTrace + '\n';
		}
		
		console.log(errorMessage);
		
		errorMessage += '\n';

		/*
		if(isLoggingToFile) {
			const logFilePath = path.join(__dirname, '/_client_log.txt');
			
			fs.appendFileSync(logFilePath, errorMessage);
		}
		*/
	}
	
	function timestampToSeconds(timestamp) {
	  const parts = timestamp.split(':');
	  const hours = parseInt(parts[0]);
	  const minutes = parseInt(parts[1]);
	  const seconds = parseFloat(parts[2]);
	  
	  return (hours * 3600) + (minutes * 60) + seconds;
	}

	function deleteDirectoryRecursive(directoryPath) {
		if (fs.existsSync(directoryPath)) {
			fs.readdirSync(directoryPath).forEach((file) => {
				const curPath = path.join(directoryPath, file);
				
				if (fs.statSync(curPath).isDirectory()) {
					deleteDirectoryRecursive(curPath);
				}
				else {
					fs.unlinkSync(curPath);
				}
			});
			
			fs.rmdirSync(directoryPath);
		}
	}
	
	function node_broadcastMessage_websocket(message) {
		websocketClient.send(JSON.stringify(message));
	}
	
	function websocketServerBroadcast(message) {
		websocketServer.clients.forEach(function each(client) {
			if (client.readyState === webSocket.OPEN) {
				client.send(JSON.stringify(message));
			}
		});
	}
	
	function cleanVideosDirectory() {
		return new Promise(function(resolve, reject) {
			logDebugMessageToConsole('cleaning imported video directories', null, null, true);
			
			if(fs.existsSync(TEMP_VIDEOS_DIRECTORY)) {
				fs.readdir(TEMP_VIDEOS_DIRECTORY, function(error, videoDirectories) {
					if (error) {
						reject(error);
					}
					else {
						if(videoDirectories.length === 0) {
							resolve();
						}
						else {
							for(const videoDirectory of videoDirectories) {
								const videoDirectoryPath = path.join(TEMP_VIDEOS_DIRECTORY, videoDirectory);
								
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
				reject('expected path does not exist: ' + TEMP_VIDEOS_DIRECTORY);
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
	
	function getRtmpStreamUrls(rtmpPort, uuid) {
		const os = require('os');
		
		const networkInterfaces = os.networkInterfaces();
		
		const rtmpUrls = [];
		
		rtmpUrls.push('rtmp://127.0.0.1:' + rtmpPort + '/live/' + uuid);
		
		for(const networkInterfaceKey of Object.keys(networkInterfaces)) {
			const networkInterface = networkInterfaces[networkInterfaceKey];
			
			for(networkInterfaceElement of networkInterface) {
				const address = networkInterfaceElement.address;
				
				const rtmpUrl = 'rtmp://' + address + ':' + rtmpPort + '/live/' + uuid;
				
				rtmpUrls.push(rtmpUrl);
			}
		}
		
		return rtmpUrls;
	}
	
	function generateFfmpegVideoArguments(videoId, resolution, format, sourceFilePath, destinationFilePath) {
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
		
		var ffmpegArguments = [];
		
		if(clientSettings.processingAgent.processingAgentType === 'cpu') {
			if(format === 'm3u8') {
				ffmpegArguments = [
					'-i', sourceFilePath,
					'-r', '30',
					'-c:a', 'aac',
					'-c:v', 'libx264', '-b:v', bitrate,
					'-profile:v', 'high',
					'-sc_threshold', '0',
					'-g', '180',
					'-vf', filterComplex,
					'-f', 'hls', 
					'-hls_time', '6', '-hls_init_time', '2',
					'-hls_segment_filename', hlsSegmentOutputPath, 
					'-hls_base_url', '/' + videoId + '/adaptive/m3u8/' + resolution + '/segments/', 
					'-hls_playlist_type', 'vod',
					destinationFilePath
				];
			}
			else if(format === 'mp4') {
				ffmpegArguments = [
					'-i', sourceFilePath,
					'-r', '30',
					'-c:a', 'aac',
					'-c:v', 'libx264', '-b:v', bitrate,
					'-vf', filterComplex,
					'-movflags', 'faststart',
					'-y',
					destinationFilePath
				];
			}
			else if(format === 'webm') {
				ffmpegArguments = [
					'-i', sourceFilePath,
					'-r', '30',
					'-c:a', 'libopus',
					'-c:v', 'libvpx-vp9', '-b:v', bitrate,
					'-vf', filterComplex,
					'-y',
					destinationFilePath
				];
			}
			else if(format === 'ogv') {
				ffmpegArguments = [
					'-i', sourceFilePath,
					'-r', '30',
					'-c:a', 'libopus',
					'-c:v', 'libvpx', '-b:v', bitrate,
					'-vf', filterComplex,
					'-y',
					destinationFilePath
				];
			}
		}
		else if(clientSettings.processingAgent.processingAgentType === 'gpu') {
			if(clientSettings.processingAgent.processingAgentName === 'NVIDIA') {
				if(format === 'm3u8') {
					ffmpegArguments = [
						'-hwaccel', 'cuvid',
						'-hwaccel_output_format', 'cuda',
						'-i', sourceFilePath,
						'-r', '30',
						'-c:a', 'aac',
						'-c:v', 'h264_nvenc', '-b:v', bitrate,
						'-profile:v', 'high',
						'-preset', 'p6',
						'-sc_threshold', '0',
						'-g', '180',
						'-vf', filterComplex,
						'-f', 'hls',
						'-hls_time', '6', '-hls_init_time', '2',
						'-hls_segment_filename', hlsSegmentOutputPath,
						'-hls_base_url', `/${videoId}/adaptive/m3u8/${resolution}/segments/`,
						'-hls_playlist_type', 'vod',
						destinationFilePath
					];
				}
				else if(format === 'mp4') {
					ffmpegArguments = [
						'-hwaccel', 'cuvid',
						'-hwaccel_output_format', 'cuda',
						'-i', sourceFilePath,
						'-r', '30',
						'-c:a', 'aac',
						'-c:v', 'h264_nvenc', '-b:v', bitrate,
						'-vf', filterComplex,
						'-movflags', 'faststart',
						'-y',
						destinationFilePath
					];
				}
				else if(format === 'webm') {
					ffmpegArguments = [
						'-i', sourceFilePath,
						'-r', '30',
						'-c:a', 'libopus',
						'-c:v', 'libvpx-vp9', '-b:v', bitrate,
						'-vf', filterComplex,
						'-y',
						destinationFilePath
					];
				}
				else if(format === 'ogv') {
					ffmpegArguments = [
						'-i', sourceFilePath,
						'-r', '30',
						'-c:a', 'libopus',
						'-c:v', 'libvpx', '-b:v', bitrate,
						'-vf', filterComplex,
						'-y',
						destinationFilePath
					];
				}
			}
			else if(clientSettings.processingAgent.processingAgentName === 'AMD') {
				if(format === 'm3u8') {
					ffmpegArguments = [
						'-hwaccel', 'dxva2',
						'-hwaccel_device', '0',
						'-i', sourceFilePath,
						'-r', '30',
						'-c:a', 'aac',
						'-c:v', 'h264_amf', '-b:v', bitrate,
						'-sc_threshold', '0',
						'-g', '180',
						'-vf', filterComplex,
						'-f', 'hls',
						'-hls_time', '6', '-hls_init_time', '2',
						'-hls_segment_filename', hlsSegmentOutputPath,
						'-hls_base_url', `/${videoId}/adaptive/m3u8/${resolution}/segments/`,
						'-hls_playlist_type', 'vod',
						destinationFilePath
					];
				}
				else if(format === 'mp4') {
					ffmpegArguments = [
						'-hwaccel', 'dxva2',
						'-hwaccel_device', '0',
						'-i', sourceFilePath,
						'-r', '30',
						'-c:a', 'aac',
						'-c:v', 'h264_amf', '-b:v', bitrate,
						'-vf', filterComplex,
						'-movflags', 'faststart',
						'-y',
						destinationFilePath
					];
				}
				else if(format === 'webm') {
					ffmpegArguments = [
						'-i', sourceFilePath,
						'-r', '30',
						'-c:a', 'libopus',
						'-c:v', 'libvpx-vp9', '-b:v', bitrate,
						'-vf', filterComplex,
						'-y',
						destinationFilePath
					];
				}
				else if(format === 'ogv') {
					ffmpegArguments = [
						'-i', sourceFilePath,
						'-r', '30',
						'-c:a', 'libopus',
						'-c:v', 'libvpx', '-b:v', bitrate,
						'-vf', filterComplex,
						'-y',
						destinationFilePath
					];
				}
			}
		}
		
		return ffmpegArguments;
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
	
	function startPublishInterval() {
		var inProgressPublishingJobCount = 0;
		var maximumInProgressPublishingJobCount = 5;
		
		const inProgressPublishingJobs = [];
		
		setInterval(function() {
			while(pendingPublishingJobs.length > 0 && inProgressPublishingJobCount < maximumInProgressPublishingJobCount) {
				inProgressPublishingJobCount++;
				
				inProgressPublishingJobs.push(pendingPublishingJobs.shift());
				
				startPublishingJob(inProgressPublishingJobs[inProgressPublishingJobs.length - 1])
				.then((completedPublishingJob) => {
					logDebugMessageToConsole('completed publishing job: ' + completedPublishingJob, null, null, true);

					const index = inProgressPublishingJobs.findIndex(function(inProgressPublishingJob) {
						return inProgressPublishingJob.videoId === completedPublishingJob.videoId && inProgressPublishingJob.format === completedPublishingJob.format && inProgressPublishingJob.resolution === completedPublishingJob.resolution;
					});
					
					inProgressPublishingJobs.splice(index, 1);
					
					const videoIdHasPendingPublishingJobExists = pendingPublishingJobs.some((pendingPublishingJob) => pendingPublishingJob.hasOwnProperty('videoId') && pendingPublishingJob.videoId === completedPublishingJob.videoId);
					const videoIdHasInProgressPublishingJobExists = inProgressPublishingJobs.some((inProgressPublishingJob) => inProgressPublishingJob.hasOwnProperty('videoId') && inProgressPublishingJob.videoId === completedPublishingJob.videoId);
					
					if(!videoIdHasPendingPublishingJobExists && !videoIdHasInProgressPublishingJobExists) {
						finishVideoPublish(completedPublishingJob.jwtToken, completedPublishingJob.videoId, completedPublishingJob.sourceFileExtension);
					}
					
					inProgressPublishingJobCount--;
				});
			}
		}, 3000);
		
		function startPublishingJob(publishingJob) {
			return new Promise(function(resolve, reject) {
				const jwtToken = publishingJob.jwtToken;
				const videoId = publishingJob.videoId;
				const format = publishingJob.format;
				const resolution = publishingJob.resolution;
				const sourceFileExtension = publishingJob.sourceFileExtension;
				const idleInterval = publishingJob.idleInterval;

				clearInterval(idleInterval);
				
				node_setVideoPublishing_database(jwtToken, videoId)
				.then(nodeResponseData => {
					if(nodeResponseData.isError) {
						resolve(publishingJob);
					}
					else {
						publishVideoEncodingTracker[videoId] = {processes: [], stopping: false};
						
						performEncodingJob(jwtToken, videoId, format, resolution, sourceFileExtension)
						.then((data) => {
							performUploadingJob(jwtToken, videoId, format, resolution)
							.then((data) => {
								resolve(publishingJob);
							})
							.catch(error => {
								resolve(publishingJob);
							});
						})
						.catch(error => {
							resolve(publishingJob);
						});
					}
				});
			});
		}
		
		function finishVideoPublish(jwtToken, videoId, sourceFileExtension) {
			deleteDirectoryRecursive(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive'));
			deleteDirectoryRecursive(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive'));
			
			const sourceFilePath =  path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/source/' + videoId + sourceFileExtension);
			
			if(fs.existsSync(sourceFilePath)) {
				const result = spawnSync(ffmpegPath, [
					'-i', sourceFilePath
				], 
				{encoding: 'utf-8' }
				);
				
				const durationIndex = result.stderr.indexOf('Duration: ');
				const lengthTimestamp = result.stderr.substr(durationIndex + 10, 11);
				const lengthSeconds = timestampToSeconds(lengthTimestamp);
				
				node_setVideoLengths_database(jwtToken, videoId, lengthSeconds, lengthTimestamp)
				.then(nodeResponseData => {
					if(nodeResponseData.isError) {
						logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
					}
					else {
						node_setVideoPublished_database(jwtToken, videoId)
						.then(nodeResponseData => {
							if(nodeResponseData.isError) {
								logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							}
							else {
								logDebugMessageToConsole('video finished publishing for id: ' + videoId, null, null, true);
								
								node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'published', videoId: videoId, lengthTimestamp: lengthTimestamp, lengthSeconds: lengthSeconds }}});
							}
						})
						.catch(error => {
							logDebugMessageToConsole(null, error, new Error().stack, true);
						});
					}
				})
				.catch(error => {
					logDebugMessageToConsole(null, error, new Error().stack, true);
				});
			}
			else {
				logDebugMessageToConsole('expected video source file to be in <' + sourceFilePath + '> but found none', null, null, true);
			}
		}
		
		function performEncodingJob(jwtToken, videoId, format, resolution, sourceFileExtension) {
			return new Promise(function(resolve, reject) {
				if(!publishVideoEncodingTracker[videoId].stopping) {
					const sourceFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/source/' + videoId + sourceFileExtension);
					
					const destinationFileExtension = '.' + format;
					var destinationFilePath = '';
					
					if(format === 'm3u8') {
						fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/' + resolution), { recursive: true });
						
						destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/manifest-' + resolution + destinationFileExtension);
					}
					else if(format === 'mp4') {
						fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/mp4/' + resolution), { recursive: true });
						
						destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/mp4/' + resolution + '/' + resolution + destinationFileExtension);
					}
					else if(format === 'webm') {
						fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/webm/' + resolution), { recursive: true });
						
						destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/webm/' + resolution + '/' + resolution + destinationFileExtension);
					}
					else if(format === 'ogv') {
						fs.mkdirSync(path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/ogv/' + resolution), { recursive: true });
						
						destinationFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/ogv/' + resolution + '/' + resolution + destinationFileExtension);
					}
					
					const ffmpegArguments = generateFfmpegVideoArguments(videoId, resolution, format, sourceFilePath, destinationFilePath);
					
					const process = spawn(ffmpegPath, ffmpegArguments);
					
					publishVideoEncodingTracker[videoId].processes.push(process);
					
					process.stdout.on('data', function (data) {
						const output = Buffer.from(data).toString();
						logDebugMessageToConsole(output, null, null, true);
					});
					
					var lengthTimestamp = '00:00:00.00';
					var lengthSeconds = 0;
					var currentTimeSeconds = 0;
					
					var stderrOutput = '';
					process.stderr.on('data', function (data) {
						if(!publishVideoEncodingTracker[videoId].stopping) {
							const stderrTemp = Buffer.from(data).toString();
							
							logDebugMessageToConsole(stderrTemp, null, null, false);
							
							if(stderrTemp.indexOf('time=') != -1) {
								logDebugMessageToConsole(stderrTemp, null, null, true);
								
								if(lengthSeconds === 0) {
									var index = stderrOutput.indexOf('Duration: ');
									lengthTimestamp = stderrOutput.substr(index + 10, 11);
									lengthSeconds = timestampToSeconds(lengthTimestamp);
								}
								
								var index = stderrTemp.indexOf('time=');
								var currentTimestamp = stderrTemp.substr(index + 5, 11);
								
								currentTimeSeconds = timestampToSeconds(currentTimestamp);
							}
							else {
								stderrOutput += stderrTemp;
							}
							
							// no need to rate limit; interval is approximately 1 second
							if(currentTimeSeconds > 0 && lengthSeconds > 0) {
								const encodingProgress = Math.ceil(((currentTimeSeconds / lengthSeconds) * 100) / 2);
								
								node_broadcastMessage_websocket({eventName: 'echo', jwtToken: jwtToken, data: {eventName: 'video_status', payload: { type: 'publishing', videoId: videoId, format: format, resolution: resolution, progress: encodingProgress }}});
							}
						}
					});
					
					process.on('spawn', function (code) {
						logDebugMessageToConsole('performEncodingJob ffmpeg process spawned with arguments: ' + ffmpegArguments, null, null, true);
					});
					
					process.on('exit', function (code) {
						logDebugMessageToConsole('performEncodingJob ffmpeg process exited with exit code: ' + code, null, null, true);
						
						if(code === 0) {
							resolve({jwtToken: jwtToken, videoId: videoId, format: format, resolution: resolution});
						}
						else {
							reject({isError: true, message: 'encoding process ended with an error code: ' + code});
						}
					});
					
					process.on('error', function (code) {
						logDebugMessageToConsole('performEncodingJob errorred with error code: ' + code, null, null, true);
					});
				}
				else {
					reject({isError: true, message: videoId + ' attempted to encode but publishing is stopping'});
				}
			});
		}
	
		function performUploadingJob(jwtToken, videoId, format, resolution) {
			return new Promise(function(resolve, reject) {			
				if(!publishVideoEncodingTracker[videoId].stopping) {
					const paths = [];
					
					if(format === 'm3u8') {
						const manifestFilePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/manifest-' + resolution + '.m3u8');
						const segmentsDirectoryPath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/adaptive/m3u8/' + resolution);
						
						paths.push({fileName : 'manifest-' + resolution + '.m3u8', filePath: manifestFilePath});
						
						fs.readdirSync(segmentsDirectoryPath).forEach(fileName => {
							const segmentFilePath = segmentsDirectoryPath + '/' + fileName;
							if (!fs.statSync(segmentFilePath).isDirectory()) {
								paths.push({fileName : fileName, filePath: segmentFilePath});
							}
						});
					}
					else if(format === 'mp4') {
						const fileName = resolution + '.mp4';
						const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/mp4/' + resolution + '/' + fileName);
						
						paths.push({fileName : fileName, filePath: filePath});
					}
					else if(format === 'webm') {
						const fileName = resolution + '.webm';
						const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/webm/' + resolution + '/' + fileName);
						
						paths.push({fileName : fileName, filePath: filePath});
					}
					else if(format === 'ogv') {
						const fileName = resolution + '.ogv';
						const filePath = path.join(TEMP_VIDEOS_DIRECTORY, videoId + '/progressive/ogv/' + resolution + '/' + fileName);
						
						paths.push({fileName : fileName, filePath: filePath});
					}
					
					node_uploadVideo_fileSystem(jwtToken, videoId, format, resolution, paths)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
							
							reject({isError: true, message: 'error communicating with the MoarTube node'});
						}
						else {
							resolve({isError: false});
						}
						
						for(const path of paths) {
							if(fs.existsSync(path.filePath)) {
								fs.unlinkSync(path.filePath);
							}
						}
					})
					.catch(error => {
						logDebugMessageToConsole(null, error, new Error().stack, true);
						
						reject({isError: true, message: 'error communicating with the MoarTube node'});
					});
				}
				else {
					reject({isError: true, message: videoId + ' attempted to upload but publishing is stopping'});
				}
			});
		}
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
														console.log('segment removed');
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

	if(global != null && global.electronPaths != null) {
		USER_DIRECTORY = path.join(global.electronPaths.userData, 'user');
		TEMP_DIRECTORY = path.join(global.electronPaths.temp, 'moartube-client/temp');
	}
	else {
		USER_DIRECTORY = path.join(__dirname, 'user');
		TEMP_DIRECTORY = path.join(__dirname, 'temp');
	}

	PUBLIC_DIRECTORY = path.join(__dirname, 'public');
	TEMP_CERTIFICATES_DIRECTORY = path.join(TEMP_DIRECTORY, 'certificates');
	TEMP_VIDEOS_DIRECTORY = path.join(TEMP_DIRECTORY, 'media/videos');

	const config = JSON.parse(fs.readFileSync(path.join(__dirname, '/config.json'), 'utf8'));
	
	MOARTUBE_CLIENT_PORT = config.clientConfig.port;
}