import { desktopPaths } from '../tooling/build-paths.cjs';
import { _electron } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const layout = desktopPaths(root, `${process.platform}-${process.arch}`);
const report = path.join(layout.reports, process.argv[2] ? 'packaged' : 'development');
mkdirSync(report, { recursive: true });
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const defaultLinuxProfile = process.platform === 'linux' && executablePath;
const profile = defaultLinuxProfile
  ? path.join(layout.profiles, 'smoke-packaged/xdg/MoarTube Client')
  : path.join(layout.profiles, executablePath ? 'smoke-packaged' : 'smoke-development');
mkdirSync(profile, { recursive: true });
const preserved = path.join(
  profile,
  'client/media/videos/desktop-smoke-preserve/adaptive/keep.txt'
);
mkdirSync(path.dirname(preserved), { recursive: true });
writeFileSync(preserved, 'preserve media across desktop starts');
const environment = {
  ...process.env,
  MOARTUBE_DESKTOP_TEST_DATA_DIR: profile,
  MOARTUBE_DESKTOP_SMOKE: '1',
};
if (defaultLinuxProfile) {
  // Exercise the real Linux/XDG default rather than the explicit test override.
  environment.XDG_CONFIG_HOME = path.dirname(profile);
  delete environment.MOARTUBE_DESKTOP_TEST_DATA_DIR;
}
delete environment.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({
  chromiumSandbox: true,
  ...(executablePath
    ? { executablePath, args: [] }
    : { args: [path.join(root, 'desktop/main.cjs')] }),
  env: environment,
  timeout: 60000,
});
let url;
let backendPid;
let closed = false;
application.on('close', () => {
  closed = true;
});
try {
  const page = await application.firstWindow();
  await page.waitForURL(/http:\/\/127\.0\.0\.1:\d+\/account\/signin/, { timeout: 90000 });
  await page.locator('#sign-in-form').waitFor({ state: 'visible' });
  url = page.url();
  const userData = await application.evaluate(({ app }) => app.getPath('userData'));
  if (userData !== profile) throw new Error(`Unexpected desktop data location: ${userData}`);
  const menuFolders = await application.evaluate(async ({ Menu, shell }) => {
    const opened = [];
    const original = shell.openPath;
    shell.openPath = async (directory) => {
      opened.push(directory);
      return '';
    };
    try {
      const file = Menu.getApplicationMenu().items.find((item) => item.label === 'File');
      file.submenu.items.find((item) => item.label === 'Open data folder').click();
      file.submenu.items.find((item) => item.label === 'Open log folder').click();
    } finally {
      shell.openPath = original;
    }
    return opened;
  });
  if (
    menuFolders[0] !== path.join(profile, 'client') ||
    menuFolders[1] !== path.join(profile, 'logs')
  )
    throw new Error('File menu points at an unexpected data/log folder');
  backendPid = await application.evaluate(
    ({ app }) =>
      app.moartubeBackendPid ??
      app.getAppMetrics().find((metric) => metric.name === 'MoarTube Client Backend')?.pid
  );
  if (!Number.isInteger(backendPid)) throw new Error('Managed backend process was not found');
  if (readFileSync(preserved, 'utf8') !== 'preserve media across desktop starts')
    throw new Error('Desktop startup removed existing media');
  const isolation = await page.evaluate(() => ({
    node: typeof window.require,
    process: typeof window.process,
    bridge: typeof window.electron,
  }));
  if (Object.values(isolation).some((value) => value !== 'undefined'))
    throw new Error('Node/Electron API leaked into the UI');
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  );
  const chromiumSandbox = await application.evaluate(
    ({ app }) => !app.commandLine.hasSwitch('no-sandbox')
  );
  if (!chromiumSandbox) throw new Error('Chromium was launched with its sandbox disabled');
  if (
    preferences.nodeIntegration !== false ||
    preferences.contextIsolation !== true ||
    preferences.sandbox !== true
  )
    throw new Error('Unexpected renderer security preferences');
  const kernelSandbox =
    process.platform === 'linux'
      ? await application.evaluate(({ BrowserWindow }) => {
          const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId();
          const status = process
            .getBuiltinModule('node:fs')
            .readFileSync(`/proc/${pid}/status`, 'utf8');
          return {
            rendererPid: pid,
            seccomp: Number(status.match(/^Seccomp:\s*(\d+)/m)?.[1]),
            noNewPrivs: Number(status.match(/^NoNewPrivs:\s*(\d+)/m)?.[1]),
            namespacePids: status
              .match(/^NSpid:\s*(.+)/m)?.[1]
              .trim()
              .split(/\s+/)
              .map(Number),
          };
        })
      : undefined;
  if (kernelSandbox && (kernelSandbox.seccomp !== 2 || kernelSandbox.noNewPrivs !== 1))
    throw new Error('Renderer kernel sandbox is not active');
  const before = readFileSync(path.join(profile, 'client/_client_settings.json'), 'utf8');
  await page.reload();
  await page.locator('#sign-in-form').waitFor({ state: 'visible' });
  if (readFileSync(path.join(profile, 'client/_client_settings.json'), 'utf8') !== before)
    throw new Error('Reload changed user settings');
  const second = spawn(
    application.process().spawnfile,
    executablePath ? [] : [path.join(root, 'desktop/main.cjs')],
    { env: environment, windowsHide: true, stdio: 'ignore' }
  );
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      second.kill();
      reject(new Error('Second desktop instance did not exit'));
    }, 8000);
    second.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    second.once('exit', (code) => {
      clearTimeout(deadline);
      if (code === 0) resolve();
      else reject(new Error(`Second desktop instance exited ${code}`));
    });
  });
  if (!(await page.locator('#sign-in-form').isVisible()))
    throw new Error('Second launch disrupted the original window');
  const screenshot = path.join(report, 'window.png');
  await page.screenshot({ path: screenshot });
  const result = {
    mode: executablePath ? 'packaged' : 'development',
    executablePath,
    url,
    isolation,
    sandbox: preferences.sandbox,
    chromiumSandbox,
    kernelSandbox,
    contextIsolation: preferences.contextIsolation,
    mediaPreserved: true,
    settingsPreserved: true,
    singleInstance: true,
    screenshot,
    backendPid,
    userData,
    menuFolders,
  };
  writeFileSync(path.join(report, 'smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (!closed) {
    const stopped = application.waitForEvent('close', { timeout: 20000 });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await stopped;
  }
}
// The UI endpoint must disappear when its desktop application exits.
if (url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    throw new Error('Desktop backend was left running after Quit');
  } catch (error) {
    if (error.message === 'Desktop backend was left running after Quit') throw error;
  }
}
console.log('Desktop quit stopped the backend.');
if (backendPid) {
  try {
    process.kill(backendPid, 0);
    throw new Error('Managed backend process survived window close');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
