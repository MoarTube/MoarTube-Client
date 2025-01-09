const http = require('http');
const express = require('express');
const expressSession = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const webSocket = require('ws');
const crypto = require('crypto');
const engine = require('express-dot-engine');

const { 
	logDebugMessageToConsole, performEncodingDecodingAssessment, cleanVideosDirectory, getPublicDirectoryPath, getDataDirectoryPath,
    getMoarTubeClientPort, setPublicDirectoryPath, setDataDirectoryPath, setCertificatesDirectoryPath,
    setVideosDirectoryPath, setFfmpegPath, setMoarTubeClientPort, setWebsocketServer, getClientSettings,
	getCertificatesDirectoryPath, getVideosDirectoryPath, setImagesDirectoryPath, getImagesDirectoryPath,
	getIsDeveloperMode, setIsDeveloperMode, getViewsDirectoryPath, setViewsDirectoryPath
} = require('./utils/helpers');

const { 
	startVideoPublishInterval 
} = require('./utils/handlers/video-publish-handler');

const {
	node_isAuthenticated 
} = require('./utils/node-communications');

const homeRoutes = require('./routes/home');
const accountRoutes = require('./routes/account');
const monetizationRoutes = require('./routes/monetization');
const linksRoutes = require('./routes/links');
const settingsRoutes = require('./routes/settings');
const videosRoutes = require('./routes/videos');
const streamsRoutes = require('./routes/streams');
const reportsVideosRoutes = require('./routes/reports-videos');
const reportsCommentsRoutes = require('./routes/reports-comments');
const commentsRoutes = require('./routes/comments');
const nodeRoutes = require('./routes/node');

startClient();

async function startClient() {
	process.on('uncaughtException', (error) => {
		/*
        ffmpeg utilizes trailer information to detect the end (end of file, EOF) of piped input to stdin.
        This will trigger an uncaught exception (Error: write EOF) due to live mpeg-ts segments not having a trailer, thus no EOF indication.
        This is benign, also reportedly does not occur on Unix-based systems, though unconfirmed.
        */
		if(!error.stack.includes('Error: write EOF')) {
			logDebugMessageToConsole(null, error, error.stackTrace);
		}
	});

	process.on('unhandledRejection', (reason, promise) => {
		logDebugMessageToConsole(null, reason, reason.stack);
	});

	logDebugMessageToConsole('starting MoarTube Client', null, null);

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

	app.engine('dot', engine.__express);
	
	app.set('views', getViewsDirectoryPath());
	app.set('view engine', 'dot');

	app.use('/', homeRoutes);
	app.use('/account', accountRoutes);
	app.use('/monetization', monetizationRoutes);
	app.use('/links', linksRoutes);
	app.use('/settings', settingsRoutes);
	app.use('/videos', videosRoutes);
	app.use('/streams', streamsRoutes);
	app.use('/reports/videos', reportsVideosRoutes);
	app.use('/reports/comments', reportsCommentsRoutes);
	app.use('/comments', commentsRoutes);
	app.use('/node', nodeRoutes);

	const httpServer = http.createServer(app);

	httpServer.requestTimeout = 0; // needed for long duration requests (streaming, large uploads)
	
	httpServer.listen(getMoarTubeClientPort(), function() {
		logDebugMessageToConsole('MoarTube Client is listening on port ' + getMoarTubeClientPort(), null, null);

		const websocketServer = new webSocket.Server({ 
			noServer: true, 
			perMessageDeflate: false 
		});

		setWebsocketServer(websocketServer);

		websocketServer.on('connection', function connection(ws) {
			logDebugMessageToConsole('browser websocket client connected', null, null);

			ws.on('close', () => {
				logDebugMessageToConsole('browser websocket client disconnected', null, null);
			});
		});
		
		httpServer.on('upgrade', function upgrade(req, socket, head) {
			websocketServer.handleUpgrade(req, socket, head, function done(ws) {
				sessionMiddleware(req, {}, () => {
					node_isAuthenticated(req.session.jwtToken)
					.then(nodeResponseData => {
						if(nodeResponseData.isError) {
							logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack);
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
						logDebugMessageToConsole(null, error, new Error().stack);
					});
				});
			});
		});
	});
}

function discoverDataDirectoryPath() {
	const dataDirectory = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share');
	const dataDirectoryPath = path.join(dataDirectory, 'moartube-client');

	return dataDirectoryPath;
}

function loadConfig() {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

	const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config_test.json'), 'utf8'));

	setIsDeveloperMode(config.isDeveloperMode);
	
	if(getIsDeveloperMode()) {
		setDataDirectoryPath(path.join(__dirname, 'data'));
	}
	else {
		setDataDirectoryPath(discoverDataDirectoryPath());
	}

	setPublicDirectoryPath(path.join(__dirname, 'public'));
	setViewsDirectoryPath(path.join(getPublicDirectoryPath(), 'views'));
	setCertificatesDirectoryPath(path.join(getDataDirectoryPath(), 'certificates'));
	setVideosDirectoryPath(path.join(getDataDirectoryPath(), 'media/videos'));
	setImagesDirectoryPath(path.join(getDataDirectoryPath(), 'images'));

	fs.mkdirSync(getDataDirectoryPath(), { recursive: true });
	fs.mkdirSync(getCertificatesDirectoryPath(), { recursive: true });
	fs.mkdirSync(getVideosDirectoryPath(), { recursive: true });
	fs.mkdirSync(getImagesDirectoryPath(), { recursive: true });

    if (!fs.existsSync(path.join(getDataDirectoryPath(), '_client_settings.json'))) {
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
					"2160p-bitrate": 15000, "1440p-bitrate": 12000, "1080p-bitrate": 10000, "720p-bitrate": 8000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
					"framerate": 30, "segmentLength": 6, "gop": 180
				},
				"mp4": { 
					"2160p-bitrate": 15000, "1440p-bitrate": 12000, "1080p-bitrate": 10000, "720p-bitrate": 8000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
					"framerate": 30, "gop": 60
				},
				"webm": { 
					"2160p-bitrate": 15000, "1440p-bitrate": 12000, "1080p-bitrate": 10000, "720p-bitrate": 8000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
					"framerate": 30, "gop": 60
				},
				"ogv": { 
					"2160p-bitrate": 15000, "1440p-bitrate": 12000, "1080p-bitrate": 10000, "720p-bitrate": 8000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
					"framerate": 30, "gop": 60
				}
			},
			"liveEncoderSettings": {
				"hls": { 
					"2160p-bitrate": 10000, "1440p-bitrate": 10000, "1080p-bitrate": 8000, "720p-bitrate": 6000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
					"framerate": 30, "segmentLength": 3, "gop": 90
				}
			}
		};

		fs.writeFileSync(path.join(getDataDirectoryPath(), '_client_settings_default.json'), JSON.stringify(clientSettings));
		fs.writeFileSync(path.join(getDataDirectoryPath(), '_client_settings.json'), JSON.stringify(clientSettings));
	}

	const clientSettings = getClientSettings();

	setMoarTubeClientPort(clientSettings.clientListeningPort);
}