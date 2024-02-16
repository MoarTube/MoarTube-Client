/*
no longer being used, but being kept in the event Electron is used again

{
  "name": "moartube-client",
  "version": "1.0.16",
  "description": "A free, open-source, self-hosted, anonymous, decentralized video/live stream platform. Scalable via Cloudflare, works in the cloud or from home WiFi.",
  "author": "MoarTube, LLC",
  "license": "Custom License - See LICENSE.md file",
  "main": "moartube-client.js",
  "scripts": {
    "start": "electron-forge start",
    "startApp": "electron main.js",
    "test": "echo \"Error: no test specified\" && exit 1",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "publish": "electron-forge publish"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/MoarTube/MoarTube-Client.git"
  },
  "keywords": ["alternative", "youtube", "twitch", "video", "stream", "live", "moartube"],
  "dependencies": {
    "axios": "^1.4.0",
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "electron-squirrel-startup": "^1.0.0",
    "express": "^4.18.2",
    "express-session": "^1.17.3",
    "ffmpeg-static": "^5.2.0",
    "form-data": "^4.0.0",
    "multer": "^1.4.5-lts.1",
    "portscanner": "^2.2.0",
    "sharp": "^0.33.0",
    "systeminformation": "^5.18.14",
    "ws": "^8.13.0"
  },
  "devDependencies": {
    "@electron-forge/cli": "^7.2.0",
    "@electron-forge/maker-deb": "^7.2.0",
    "@electron-forge/maker-rpm": "^7.2.0",
    "@electron-forge/maker-squirrel": "^7.2.0",
    "@electron-forge/maker-zip": "^7.2.0",
    "@electron-forge/plugin-auto-unpack-natives": "^7.2.0",
    "@electron-forge/publisher-github": "^7.2.0",
    "electron": "^28.0.0"
  }
}
*/

const { app, BrowserWindow } = require("electron");

global.electronPaths = {
    userData: app.getPath('userData'),
    temp: app.getPath('temp'),
    appData: app.getPath('appData'),
};

require("./moartube-client.js");

if (handleSquirrelEvent()) {
    return;
}

function handleSquirrelEvent() {
    if (process.argv.length === 1) {
        return false;
    }

    const ChildProcess = require('child_process');
    const path = require('path');

    const appFolder = path.resolve(process.execPath, '..');
    const rootAtomFolder = path.resolve(appFolder, '..');
    const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
    const exeName = path.basename(process.execPath);

    const spawn = function(command, args) {
        let spawnedProcess, error;

        try {
        spawnedProcess = ChildProcess.spawn(command, args, {detached: true});
        } catch (error) {}

        return spawnedProcess;
    };

    const spawnUpdate = function(args) {
        return spawn(updateDotExe, args);
    };

    const squirrelEvent = process.argv[1];
    switch (squirrelEvent) {
        case '--squirrel-install':
        case '--squirrel-updated':
        // Optionally do things such as:
        // - Add your .exe to the PATH
        // - Write to the registry for things like file associations and
        //   explorer context menus

        // Install desktop and start menu shortcuts
        spawnUpdate(['--createShortcut', exeName]);

        setTimeout(app.quit, 1000);
        return true;

        case '--squirrel-uninstall':
        // Undo anything you did in the --squirrel-install and
        // --squirrel-updated handlers

        // Remove desktop and start menu shortcuts
        spawnUpdate(['--removeShortcut', exeName]);

        setTimeout(app.quit, 1000);
        return true;

        case '--squirrel-obsolete':
        // This is called on the outgoing version of your app before
        // we update to the new version - it's the opposite of
        // --squirrel-updated

        app.quit();
        return true;
    }
}


let mainWindow;
 
function createWindow() {
    mainWindow = new BrowserWindow({ show: false });

    mainWindow.loadURL("http://localhost:8080");

    mainWindow.on("closed", function () {
        mainWindow = null;
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });
}
 
app.on("ready", createWindow);
 
app.on("resize", function (e, x, y) {
    mainWindow.setSize(x, y);
});
 
app.on("window-all-closed", function () {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
 
app.on("activate", function () {
    if (mainWindow === null) {
        createWindow();
    }
});