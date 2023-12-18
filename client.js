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








const { 
	logDebugMessageToConsole, 
	performEncodingDecodingAssessment,
	cleanVideosDirectory,
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

const { startPublishInterval } = require('./utils/video-upload-handler');

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
const indexRoutes = require('./routes/index');
const aliasRoutes = require('./routes/alias');


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
	app.use('/index', indexRoutes);
	app.use('/alias', aliasRoutes);

	
	
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