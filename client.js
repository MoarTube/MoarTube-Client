const http = require('http');
const express = require('express');
const expressSession = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const webSocket = require('ws');
const crypto = require('crypto');

const { 
	logDebugMessageToConsole, performEncodingDecodingAssessment, cleanVideosDirectory, getPublicDirectoryPath, getAppDataDirectoryPath,
    getMoarTubeClientPort, setPublicDirectoryPath, setAppDataDirectoryPath, setAppDataCertificatesDirectoryPath,
    setAppDataVideosDirectoryPath, setFfmpegPath, setMoarTubeClientPort, setWebsocketServer, getClientSettings,
	getAppDataCertificatesDirectoryPath, getAppDataVideosDirectoryPath, setAppDataImagesDirectoryPath, getAppDataImagesDirectoryPath
} = require('./utils/helpers');

const { 
	startVideoPublishInterval 
} = require('./utils/handlers/video-publish-handler');

const {
	node_isAuthenticated 
} = require('./utils/node-communications');

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
const nodeRoutes = require('./routes/node');

startClient();

async function startClient() {
	process.on('uncaughtException', (error) => {
		logDebugMessageToConsole(null, error, error.stackTrace, true);
	});

	process.on('unhandledRejection', (reason, promise) => {
		logDebugMessageToConsole(null, reason, reason.stack, true);
	});

	logDebugMessageToConsole('starting MoarTube Client', null, null, true);

	loadConfig();

	setFfmpegPath(ffmpegPath);

	cleanVideosDirectory();
	
	performEncodingDecodingAssessment();

	startVideoPublishInterval();
	
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

	app.use(function(req, res, next) {
		next();
	});

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
	app.use('/node', nodeRoutes);

	const httpServer = http.createServer(app);

	httpServer.requestTimeout = 0; // needed for long duration requests (streaming, large uploads)
	
	httpServer.listen(getMoarTubeClientPort(), function() {
		logDebugMessageToConsole('MoarTube Client is listening on port ' + getMoarTubeClientPort(), null, null, true);

		const websocketServer = new webSocket.Server({ 
			noServer: true, 
			perMessageDeflate: false 
		});

		setWebsocketServer(websocketServer);

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
}
	
function loadConfig() {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

	setPublicDirectoryPath(path.join(__dirname, 'public'));

	if(global != null && global.electronPaths != null) {
		// C:/Users/<user>/AppData/Roaming/moartube-client
		setAppDataDirectoryPath(path.join(global.electronPaths.appData, 'moartube-client'));
	}
	else {
		setAppDataDirectoryPath(path.join(__dirname, 'temp'));
	}
	
	setAppDataCertificatesDirectoryPath(path.join(getAppDataDirectoryPath(), 'certificates'));
	setAppDataVideosDirectoryPath(path.join(getAppDataDirectoryPath(), 'media/videos'));
	setAppDataImagesDirectoryPath(path.join(getAppDataDirectoryPath(), 'images'));

	logDebugMessageToConsole('creating required directories and files', null, null, true);

    if (!fs.existsSync(getAppDataDirectoryPath())) {
		fs.mkdirSync(getAppDataDirectoryPath(), { recursive: true });
	}

	if (!fs.existsSync(getAppDataCertificatesDirectoryPath())) {
		fs.mkdirSync(getAppDataCertificatesDirectoryPath(), { recursive: true });
	}

	if (!fs.existsSync(getAppDataVideosDirectoryPath())) {
		fs.mkdirSync(getAppDataVideosDirectoryPath(), { recursive: true });
	}

	if (!fs.existsSync(getAppDataImagesDirectoryPath())) {
		fs.mkdirSync(getAppDataImagesDirectoryPath(), { recursive: true });
	}

    if (!fs.existsSync(path.join(getAppDataDirectoryPath(), '_client_settings.json'))) {
		const clientSettings = {
            "clientListeningPort":8080,
			"processingAgent":{
				"processingAgentType":"cpu",
				"processingAgentName":"",
				"processingAgentModel":""
			},
			// bitrate units are in kilobytes per second
			"videoEncoderSettings": {
				"hls": { 
					"2160p-bitrate": "15000", "1440p-bitrate": "12000", "1080p-bitrate": "10000", "720p-bitrate": "8000", "480p-bitrate": "5000", "360p-bitrate": "4000", "240p-bitrate": "3000",
					"gop": 180, "framerate": 30, "segmentLength": 6
				},
				"mp4": { 
					"2160p-bitrate": "15000", "1440p-bitrate": "12000", "1080p-bitrate": "10000", "720p-bitrate": "8000", "480p-bitrate": "5000", "360p-bitrate": "4000", "240p-bitrate": "3000",
					"gop": 60, "framerate": 30
				},
				"webm": { 
					"2160p-bitrate": "15000", "1440p-bitrate": "12000", "1080p-bitrate": "10000", "720p-bitrate": "8000", "480p-bitrate": "5000", "360p-bitrate": "4000", "240p-bitrate": "3000",
					"gop": 60, "framerate": 30
				},
				"ogv": { 
					"2160p-bitrate": "15000", "1440p-bitrate": "12000", "1080p-bitrate": "10000", "720p-bitrate": "8000", "480p-bitrate": "5000", "360p-bitrate": "4000", "240p-bitrate": "3000",
					"gop": 60, "framerate": 30
				}
			},
			"liveEncoderSettings": {
				"hls": { 
					"2160p-bitrate": "10000", "1440p-bitrate": "10000", "1080p-bitrate": "8000", "720p-bitrate": "6000", "480p-bitrate": "5000", "360p-bitrate": "4000", "240p-bitrate": "3000",
					"gop": 90, "framerate": 30, "segmentLength": 3
				}
			}
		};

		fs.writeFileSync(path.join(getAppDataDirectoryPath(), '_client_settings_default.json'), JSON.stringify(clientSettings));
		fs.writeFileSync(path.join(getAppDataDirectoryPath(), '_client_settings.json'), JSON.stringify(clientSettings));
	}

	const clientSettings = getClientSettings();

	setMoarTubeClientPort(clientSettings.clientListeningPort);
}