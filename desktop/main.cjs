const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, fork } = require('node:child_process');
const {
  supportsDesktopTarget,
  isLocalNavigation,
  isExternalLink,
  readyOrigin,
  allowPermission,
} = require('./policy.cjs');
const linuxProcesses = require('./linux-processes.cjs');

app.setName('MoarTube Client');
const applicationRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
const version = require('../package.json').version;
if (process.platform === 'win32') app.setAppUserModelId('com.moartube.client');
if (process.platform === 'linux') app.setDesktopName('moartube-client.desktop');
// Development never modifies the installed app's data or the CLI checkout's data.
const userDirectory = process.env.MOARTUBE_DESKTOP_TEST_DATA_DIR
  ? path.resolve(process.env.MOARTUBE_DESKTOP_TEST_DATA_DIR)
  : app.isPackaged
    ? path.join(app.getPath('appData'), 'MoarTube Client')
    : path.join(
        __dirname,
        `../build/desktop/profiles/${process.platform}-${process.arch}/development`
      );
fs.mkdirSync(userDirectory, { recursive: true });
app.setPath('userData', userDirectory);
let window;
let backend;
let backendIdentity;
let origin;
let quitting = false;
let backendExited = false;
let log;
let startupTimer;
let failureShown = false;
let exitCode = 0;

function fail(message) {
  if (quitting || failureShown) return;
  failureShown = true;
  exitCode = 1;
  clearTimeout(startupTimer);
  const detail = `${message}\n\nLog: ${path.join(app.getPath('userData'), 'logs/client.log')}`;
  if (process.env.MOARTUBE_DESKTOP_SMOKE === '1') console.error(detail);
  else dialog.showErrorBox('MoarTube Client could not start', detail);
  app.quit();
}

async function stopBackend() {
  clearTimeout(startupTimer);
  if (!backend || backendExited) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Kill only our owned utility process tree, including any remaining FFmpeg
      // jobs, if graceful shutdown cannot finish. Never target processes by name.
      if (!backendExited && Number.isInteger(backend.pid)) {
        if (process.platform === 'linux') {
          linuxProcesses.terminateOwnedTree(backend.pid, backendIdentity);
          resolve();
          return;
        }
        if (process.platform === 'darwin') {
          // The Mac backend owns a separate process group, including media jobs.
          try {
            process.kill(-backend.pid, 'SIGKILL');
          } catch {
            backend.kill();
          }
          resolve();
          return;
        }
        const killer = spawn('taskkill.exe', ['/PID', String(backend.pid), '/T', '/F'], {
          windowsHide: true,
        });
        killer.once('error', () => {
          backend.kill();
          resolve();
        });
        killer.once('close', resolve);
      } else resolve();
    }, 8000);
    backend.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    backend.postMessage({ type: 'shutdown' });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    if (window && !window.isDestroyed()) window.hide();
    void stopBackend().finally(() => {
      log?.end();
      app.exit(exitCode);
    });
  });
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(async () => {
      if (!supportsDesktopTarget(process.platform, process.arch))
        throw new Error(
          'This Electron candidate supports Windows x64, Linux x64/ARM64 and macOS x64/ARM64.'
        );
      const userData = app.getPath('userData');
      fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
      const logPath = path.join(userData, 'logs/client.log');
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 5 * 1024 * 1024) {
        fs.copyFileSync(logPath, `${logPath}.previous`);
        fs.truncateSync(logPath);
      }
      log = fs.createWriteStream(logPath, { flags: 'a' });
      log.on('error', (error) => console.error('Desktop log:', error));
      log.write(`\nMoarTube Client ${version} starting ${new Date().toISOString()}\n`);
      window = new BrowserWindow({
        width: 1280,
        height: 900,
        minWidth: 960,
        minHeight: 650,
        title: 'MoarTube Client',
        backgroundColor: '#f8f9fa',
        icon: path.join(
          applicationRoot,
          process.platform === 'linux' ? 'desktop/icon.png' : 'dist/public/images/favicon.ico'
        ),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        },
      });
      window.on('closed', () => {
        window = undefined;
      });
      window.webContents.session.setPermissionRequestHandler((contents, permission, callback) =>
        callback(
          Boolean(
            origin &&
            contents === window?.webContents &&
            allowPermission(permission, contents.getURL(), origin)
          )
        )
      );
      window.webContents.session.setPermissionCheckHandler(
        (contents, permission, requestingOrigin) =>
          Boolean(
            origin &&
            contents === window?.webContents &&
            allowPermission(permission, requestingOrigin, origin)
          )
      );
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.webContents.on('dom-ready', () => {
        if (
          window &&
          !window.isDestroyed() &&
          origin &&
          isLocalNavigation(window.webContents.getURL(), origin)
        ) {
          // Existing web templates reference a remote Open Sans font. Use the
          // System UI font offline without changing the web/CLI UI.
          void window.webContents
            .insertCSS(
              'body{font-family:"Segoe UI",system-ui,sans-serif!important}h1,h2,h3,h4,h5,h6,p,a,label,button,input,select,textarea{font-family:inherit!important}',
              { cssOrigin: 'user' }
            )
            .catch(() => {});
        }
      });
      const navigate = (event, url) => {
        if (origin && isLocalNavigation(url, origin)) return;
        event.preventDefault();
        if (isExternalLink(url)) void shell.openExternal(url);
      };
      window.webContents.on('will-navigate', navigate);
      window.webContents.on('will-redirect', navigate);
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (origin && isLocalNavigation(url, origin)) void window.loadURL(url);
        else if (isExternalLink(url)) void shell.openExternal(url);
        return { action: 'deny' };
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
          {
            label: 'File',
            submenu: [
              {
                label: 'Open data folder',
                click: () => {
                  void shell.openPath(path.join(userData, 'client'));
                },
              },
              {
                label: 'Open log folder',
                click: () => {
                  void shell.openPath(path.join(userData, 'logs'));
                },
              },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          {
            label: 'Edit',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' },
            ],
          },
          {
            label: 'View',
            submenu: [
              { role: 'reload' },
              { role: 'resetZoom' },
              { role: 'zoomIn' },
              { role: 'zoomOut' },
              ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
            ],
          },
          {
            label: 'Help',
            submenu: [
              {
                label: 'FFmpeg licenses and source information',
                click: () => {
                  void shell.openPath(
                    app.isPackaged
                      ? path.join(
                          process.resourcesPath,
                          `ffmpeg/${process.platform}-${process.arch}`
                        )
                      : path.join(applicationRoot, 'tooling/ffmpeg')
                  );
                },
              },
              {
                label: 'About MoarTube Client',
                click: () => {
                  void dialog.showMessageBox(window, {
                    type: 'info',
                    title: 'MoarTube Client',
                    message: `MoarTube Client ${version}`,
                    detail:
                      'Closing the window quits the app and stops active imports, publishing and live streams.\n\nConnect to your MoarTube Node from the sign-in screen. FFmpeg and FFprobe are bundled with this application.',
                  });
                },
              },
            ],
          },
        ])
      );
      await window.loadFile(path.join(__dirname, 'loading.html'));
      const environment = {
        ...process.env,
        MOARTUBE_DATA_DIR: path.join(userData, 'client'),
        MOARTUBE_DESKTOP_MODE: app.isPackaged ? 'packaged' : 'development',
        MOARTUBE_METRICS_ROOT_PID: String(process.pid),
      };
      // Select product resources explicitly; development must not look inside
      // node_modules/electron/dist/resources for the compiled media dependency.
      if (app.isPackaged) {
        environment.MOARTUBE_RESOURCE_ROOT = process.resourcesPath;
        delete environment.FFMPEG_BIN;
      } else environment.MOARTUBE_RESOURCE_ROOT = '';
      if (process.platform === 'linux' || process.platform === 'darwin') {
        environment.MOARTUBE_DESKTOP_NODE_BACKEND = '1';
        const entry = app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar.unpacked/dist/desktop-backend.js')
          : path.join(applicationRoot, 'dist/desktop-backend.js');
        backend = fork(entry, [], {
          execPath: app.isPackaged
            ? path.join(process.resourcesPath, 'runtime/node')
            : (process.env.npm_node_execpath ?? 'node'),
          execArgv: [],
          detached: process.platform === 'darwin',
          env: environment,
          cwd: userData,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        const child = backend;
        backend.postMessage = (message) => {
          if (child.connected)
            child.send(message, (error) => {
              if (error && !quitting) fail(`The backend IPC channel failed: ${error.message}`);
            });
        };
      } else {
        backend = utilityProcess.fork(path.join(applicationRoot, 'dist/desktop-backend.js'), [], {
          env: environment,
          cwd: userData,
          stdio: 'pipe',
          serviceName: 'MoarTube Client Backend',
        });
      }
      backend.stdout?.on('data', (chunk) => log.write(chunk));
      backend.on('spawn', () => {
        if (process.platform === 'linux') backendIdentity = linuxProcesses.identity(backend.pid);
        if (process.env.MOARTUBE_DESKTOP_SMOKE === '1') app.moartubeBackendPid = backend.pid;
      });
      backend.stderr?.on('data', (chunk) => log.write(chunk));
      backend.on('error', (error) => fail(`The client backend could not start: ${error.message}`));
      backend.on('message', (message) => {
        if (quitting || !window || window.isDestroyed()) return;
        if (message?.type === 'error') {
          fail(String(message.message));
          return;
        }
        const ready = readyOrigin(message);
        if (ready) {
          clearTimeout(startupTimer);
          origin = ready;
          void window.loadURL(`${origin}/account/signin`).catch((error) => fail(error.message));
        }
      });
      backend.on('exit', (code) => {
        backendExited = true;
        if (!quitting) fail(`The client backend stopped unexpectedly (exit ${code}).`);
      });
      startupTimer = setTimeout(
        () => fail('The client backend did not become ready within 90 seconds.'),
        90000
      );
    })
    .catch((error) => fail(error.message));
}
