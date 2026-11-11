const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  dialog,
  shell,
  screen,
  utilityProcess,
} = require('electron');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
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
const { createAutostart, AUTOSTART_ARGUMENT } = require('./autostart.cjs');
const { desktopLayout, prepareData } = require('../src/config/data-layout.cjs');

app.setName('MoarTube Client');
const applicationRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
const version = require('../package.json').version;
const bundled =
  ['win32', 'linux'].includes(process.platform) &&
  (app.isPackaged
    ? require('../package.json').moartubeBundledNode === true
    : process.env.MOARTUBE_DESKTOP_BUNDLED === '1');
const desktopKey = bundled ? randomBytes(32).toString('hex') : undefined;
if (bundled) app.setName('MoarTube Client + Node');
const startedInTray =
  process.argv.includes(AUTOSTART_ARGUMENT) ||
  (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
let showMainWindow = !startedInTray;
if (process.platform === 'win32') {
  app.setAppUserModelId(bundled ? 'com.moartube.desktop' : 'com.moartube.client');
  if (bundled) app.setName('MoarTube Client + Node');
}
if (process.platform === 'linux')
  app.setDesktopName(bundled ? 'moartube-client-node.desktop' : 'moartube-client.desktop');
// Development never modifies the installed app's data or the CLI checkout's data.
const isolatedProfile = Boolean(process.env.MOARTUBE_DESKTOP_TEST_DATA_DIR) || !app.isPackaged;
const isolatedBase = process.env.MOARTUBE_DESKTOP_TEST_DATA_DIR
  ? path.resolve(process.env.MOARTUBE_DESKTOP_TEST_DATA_DIR)
  : path.join(
      applicationRoot,
      `build/desktop/profiles/${process.platform}-${process.arch}/development`
    );
const dataLayout = desktopLayout(bundled, {
  env: isolatedProfile ? { ...process.env, MOARTUBE_DATA_ROOT: isolatedBase } : process.env,
});
const userDirectory = dataLayout.userData;
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
let tray;
let bundledNode;
let autostart;
let trayMenu;
let windowMenu;
const startupAbort = new AbortController();

function showWindow() {
  showMainWindow = true;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.setSkipTaskbar(false);
  window.show();
  window.focus();
}

function fail(message) {
  if (quitting || failureShown) return;
  failureShown = true;
  exitCode = 1;
  clearTimeout(startupTimer);
  const detail = `${message}\n\nLog: ${path.join(app.getPath('userData'), 'logs/client.log')}`;
  if (process.env.MOARTUBE_DESKTOP_SMOKE === '1' || startedInTray) console.error(detail);
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

const ownsInstance = app.requestSingleInstanceLock({ autostart: startedInTray });
if (!ownsInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _directory, data) => {
    if (process.env.MOARTUBE_DESKTOP_SMOKE === '1') app.moartubeLastLaunch = { argv, data };
    if (data?.autostart ?? argv.includes(AUTOSTART_ARGUMENT)) return;
    showWindow();
  });
  app.on('activate', () => {
    if (window && origin) showWindow();
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    startupAbort.abort();
    if (window && !window.isDestroyed()) window.hide();
    void stopBackend().finally(async () => {
      await bundledNode?.stop();
      tray?.destroy();
      log?.end();
      app.exit(exitCode);
    });
  });
  app.on('window-all-closed', () => {
    if (!bundled) app.quit();
  });
  app
    .whenReady()
    .then(async () => {
      if (!supportsDesktopTarget(process.platform, process.arch))
        throw new Error(
          'This Electron candidate supports Windows x64, Linux x64/ARM64 and macOS x64/ARM64.'
        );
      for (const component of bundled ? ['node', 'client'] : ['client']) {
        const release = await prepareData(component, { target: dataLayout[component] });
        release();
      }
      if (quitting) return;
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
      {
        try {
          // Development and automated profiles never register Electron or test
          // executables in the user's real system startup configuration.
          autostart = createAutostart({
            app,
            userData,
            appId: bundled ? 'com.moartube.desktop' : 'com.moartube.client',
            manageLoginItem: app.isPackaged && process.env.MOARTUBE_DESKTOP_SMOKE !== '1',
          });
          if (autostart.startupError) log.write(`Autostart: ${autostart.startupError.message}\n`);
        } catch (error) {
          log.write(`Autostart: ${error.message}\n`);
        }
      }
      function syncAutostart() {
        for (const menu of [trayMenu, windowMenu]) {
          const item = menu?.getMenuItemById('autostart');
          if (item) item.checked = autostart?.enabled ?? false;
          const closeItem = menu?.getMenuItemById('minimize-on-close');
          if (closeItem) closeItem.checked = autostart?.minimizeOnClose ?? true;
        }
        if (trayMenu) tray?.setContextMenu(trayMenu);
      }
      function autostartItem() {
        return {
          id: 'autostart',
          label: 'Autostart',
          type: 'checkbox',
          checked: autostart?.enabled ?? false,
          enabled: Boolean(
            autostart && (app.isPackaged || process.env.MOARTUBE_DESKTOP_SMOKE === '1')
          ),
          click: (item) => {
            try {
              autostart.setEnabled(item.checked);
            } catch (error) {
              log.write(`Autostart: ${error.message}\n`);
              void dialog.showMessageBox(window, {
                type: 'error',
                message: 'Could not update Autostart',
                detail: error.message,
              });
            } finally {
              syncAutostart();
            }
          },
        };
      }
      function minimizeOnCloseItem() {
        return {
          id: 'minimize-on-close',
          label: 'Minimize on Close',
          type: 'checkbox',
          checked: autostart?.minimizeOnClose ?? true,
          enabled: Boolean(autostart),
          click: (item) => {
            try {
              autostart.setMinimizeOnClose(item.checked);
            } catch (error) {
              void dialog.showMessageBox(window, {
                type: 'error',
                message: 'Could not update Minimize on Close',
                detail: error.message,
              });
            } finally {
              syncAutostart();
            }
          },
        };
      }
      const workArea = screen.getPrimaryDisplay().workArea;
      const width = Math.round(workArea.width * 0.80);
      const height = Math.round(workArea.height * 0.80);
      window = new BrowserWindow({
        show: showMainWindow,
        skipTaskbar: !showMainWindow,
        width,
        height,
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
        minWidth: Math.min(960, width),
        minHeight: Math.min(650, height),
        title: 'MoarTube Client',
        backgroundColor: '#fffcf8',
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
      if (process.env.MOARTUBE_DESKTOP_SMOKE === '1') {
        app.moartubeWindowShowCount = window.isVisible() ? 1 : 0;
        window.on('show', () => {
          app.moartubeWindowShowCount++;
        });
      }
      {
        window.on('close', (event) => {
          if (!quitting) {
            event.preventDefault();
            if (!(autostart?.minimizeOnClose ?? true)) {
              app.quit();
            } else if (!tray || process.platform === 'linux') {
              // Some Linux desktops do not display status icons. Keep a taskbar
              // entry so the running app can always be restored.
              window.minimize();
            } else {
              window.hide();
              window.setSkipTaskbar(true);
            }
          }
        });
        const icon = nativeImage.createFromPath(
          path.join(
            applicationRoot,
            process.platform === 'win32'
              ? 'dist/public/images/favicon.ico'
              : app.isPackaged
                ? 'desktop/icon.png'
                : 'build/desktop/assets/icon.png'
          )
        );
        const trayIcon = icon.resize({ width: 16, height: 16 });
        if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
        try {
          tray = new Tray(trayIcon);
        } catch (error) {
          log.write(`Tray: ${error.message}\n`);
        }
        if (tray) {
          tray.setToolTip('MoarTube');
          trayMenu = Menu.buildFromTemplate([
            { label: 'Open MoarTube', click: showWindow },
            autostartItem(),
            minimizeOnCloseItem(),
            { type: 'separator' },
            { label: 'Quit MoarTube', click: () => app.quit() },
          ]);
          tray.setContextMenu(trayMenu);
          const refreshAutostart = () => {
            try {
              autostart?.refresh();
              syncAutostart();
            } catch (error) {
              log.write(`Autostart: ${error.message}\n`);
            }
          };
          window.on('focus', refreshAutostart);
          tray.on('right-click', refreshAutostart);
          tray.on('click', showWindow);
          if (process.env.MOARTUBE_DESKTOP_SMOKE === '1') app.moartubeRestore = showWindow;
          if (process.env.MOARTUBE_DESKTOP_SMOKE === '1') app.moartubeTrayMenu = trayMenu;
        }
      }
      if (bundled) {
        window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
          const headers = { ...details.requestHeaders };
          if (origin && isLocalNavigation(details.url.replace(/^ws:/, 'http:'), origin)) {
            headers['X-MoarTube-Desktop-Key'] = desktopKey;
          }
          callback({ requestHeaders: headers });
        });
      }
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
      windowMenu = Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
        {
          label: 'File',
          submenu: [
            {
              label: 'Open data folder',
              click: () => {
                void shell.openPath(bundled ? dataLayout.base : dataLayout.client);
              },
            },
            {
              label: 'Open log folder',
              click: () => {
                void shell.openPath(path.join(userData, 'logs'));
              },
            },
            autostartItem(),
            minimizeOnCloseItem(),
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
                    ? path.join(process.resourcesPath, `ffmpeg/${process.platform}-${process.arch}`)
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
                    'Autostart and Minimize on Close are available in the File and tray menus. When Minimize on Close is off, closing the window quits MoarTube and stops its managed processes. Quit MoarTube always stops the app.\n\n' +
                    (bundled
                      ? 'MoarTube Client and Node run together. Their runtimes, Cloudflared, FFmpeg and FFprobe are bundled.'
                      : 'Connect to your MoarTube Node from the sign-in screen. FFmpeg and FFprobe are bundled with this application.'),
                });
              },
            },
          ],
        },
      ]);
      Menu.setApplicationMenu(windowMenu);
      await window.loadFile(path.join(__dirname, 'loading.html'));
      const startupScreenShownAt = performance.now();
      if (process.env.MOARTUBE_DESKTOP_SMOKE === '1')
        app.moartubeStartupScreenShownAt = startupScreenShownAt;
      const environment = {
        ...process.env,
        MOARTUBE_DATA_DIR: dataLayout.client,
        MOARTUBE_DESKTOP_MODE: app.isPackaged ? 'packaged' : 'development',
        MOARTUBE_METRICS_ROOT_PID: String(process.pid),
      };
      // Select product resources explicitly; development must not look inside
      // node_modules/electron/dist/resources for the compiled media dependency.
      if (app.isPackaged) {
        environment.MOARTUBE_RESOURCE_ROOT = process.resourcesPath;
        delete environment.FFMPEG_BIN;
      } else environment.MOARTUBE_RESOURCE_ROOT = '';
      if (bundled) {
        const resources = app.isPackaged
          ? process.resourcesPath
          : path.join(
              applicationRoot,
              `build/desktop/work/${process.platform}-${process.arch}/staging/bundled`
            );
        bundledNode = await require('./bundled-node.cjs').startNode({
          directory: path.join(
            resources,
            app.isPackaged && process.platform === 'win32' ? 'node.asar' : 'node'
          ),
          runtime: process.platform === 'win32' ? undefined : path.join(resources, 'runtime/node'),
          utility: process.platform === 'win32' ? utilityProcess : undefined,
          data: dataLayout.node,
          log,
          onFailure: fail,
          signal: startupAbort.signal,
          onSpawn: (pid) => {
            if (process.env.MOARTUBE_DESKTOP_SMOKE === '1') app.moartubeNodePid = pid;
          },
        });
        const port = await bundledNode.ready;
        if (quitting) {
          await bundledNode.stop();
          return;
        }
        environment.MOARTUBE_BUNDLED_NODE_PORT = String(port);
        environment.MOARTUBE_DESKTOP_KEY = desktopKey;
        if (process.env.MOARTUBE_DESKTOP_SMOKE === '1') app.moartubeNodePort = port;
      }
      if (process.platform === 'linux' || process.platform === 'darwin') {
        environment.MOARTUBE_DESKTOP_NODE_BACKEND = '1';
        const entry = app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar.unpacked/dist/desktop-backend.js')
          : path.join(applicationRoot, 'dist/desktop-backend.js');
        backend = fork(entry, [], {
          execPath: bundled
            ? path.join(
                app.isPackaged
                  ? process.resourcesPath
                  : path.join(
                      applicationRoot,
                      `build/desktop/work/${process.platform}-${process.arch}/staging/bundled`
                    ),
                process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/node'
              )
            : app.isPackaged
              ? path.join(process.resourcesPath, 'runtime/node')
              : (process.env.npm_node_execpath ?? 'node'),
          execArgv: [],
          detached: process.platform === 'darwin',
          windowsHide: true,
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
        if (ready && !origin) {
          clearTimeout(startupTimer);
          origin = ready;
          // Initialization runs during the minimum display time. Slow startups
          // proceed as soon as they are ready, without adding another 5 seconds.
          const remaining = Math.max(0, Math.ceil(5000 - (performance.now() - startupScreenShownAt)));
          void delay(remaining, undefined, { signal: startupAbort.signal })
            .then(() => {
              if (quitting || failureShown || backendExited || !window || window.isDestroyed())
                return;
              return window.loadURL(`${origin}/account/signin`);
            })
            .catch((error) => {
              if (!quitting) fail(error.message);
            });
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
