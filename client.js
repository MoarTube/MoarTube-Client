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
	logDebugMessageToConsole, performEncodingDecodingAssessment, createRequiredAssets, cleanVideosDirectory, getPublicDirectoryPath, getTempDirectoryPath,
    getMoarTubeClientPort, setPublicDirectoryPath, setUserDirectoryPath, setTempDirectoryPath, setTempCertificatesDirectoryPath,
    setTempVideosDirectoryPath, setFfmpegPath, setMoarTubeClientPort, setWebsocketServer, getClientSettings
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
const channelRoutes = require('./routes/channel');
const indexRoutes = require('./routes/index');
const aliasRoutes = require('./routes/alias');

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
	
	createRequiredAssets();

	await cleanVideosDirectory();
	
	await performEncodingDecodingAssessment();

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
	app.use('/channel', channelRoutes);
	app.use('/index', indexRoutes);
	app.use('/alias', aliasRoutes);

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

	logDebugMessageToConsole('configured MoarTube Client to use client settings: ' + JSON.stringify(getClientSettings()), null, null, true);
}