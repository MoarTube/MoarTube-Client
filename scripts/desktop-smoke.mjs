import { desktopPaths } from '../tooling/build-paths.cjs';
import { _electron } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const layout = desktopPaths(root, `${process.platform}-${process.arch}`);
const report = path.join(layout.reports, process.argv[2] ? 'packaged' : 'development');
mkdirSync(report, { recursive: true });
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const launchExecutable = executablePath ?? (await import('electron')).default;
const defaultLinuxProfile = process.platform === 'linux' && executablePath;
const profileBase = path.join(
  layout.profiles,
  executablePath ? 'smoke-packaged' : 'smoke-development'
);
const dataBase = defaultLinuxProfile
  ? path.join(profileBase, 'xdg/MoarTube')
  : path.join(profileBase, 'MoarTube');
const profile = path.join(dataBase, 'client');
const desktopProfile = path.join(profile, 'desktop');
mkdirSync(desktopProfile, { recursive: true });
writeFileSync(
  path.join(desktopProfile, 'desktop-settings.json'),
  JSON.stringify({ autostart: true, minimizeOnClose: true })
);
mkdirSync(profile, { recursive: true });
const preserved = path.join(profile, 'media/videos/desktop-smoke-preserve/adaptive/keep.txt');
mkdirSync(path.dirname(preserved), { recursive: true });
writeFileSync(preserved, 'preserve media across desktop starts');
const environment = {
  ...process.env,
  MOARTUBE_DESKTOP_TEST_DATA_DIR: profileBase,
  MOARTUBE_DESKTOP_SMOKE: '1',
};
if (defaultLinuxProfile) {
  // Exercise the real Linux/XDG default rather than the explicit test override.
  environment.XDG_DATA_HOME = path.dirname(dataBase);
  delete environment.MOARTUBE_DESKTOP_TEST_DATA_DIR;
}
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.MOARTUBE_DESKTOP_BUNDLED;
const application = await _electron.launch({
  chromiumSandbox: true,
  ...(executablePath
    ? { executablePath, args: ['--autostart'] }
    : { args: [path.join(root, 'desktop/main.cjs'), '--autostart'] }),
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
  assert.ok(
    await application.evaluate(
      ({ app }) => performance.now() - app.moartubeStartupScreenShownAt >= 8000
    ),
    'The startup screen must remain displayed for at least 8 seconds'
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false
  );
  assert.equal(await application.evaluate(({ app }) => app.moartubeWindowShowCount), 0);
  const states = () =>
    application.evaluate(({ Menu, app }) =>
      ['autostart', 'minimize-on-close'].map((id) => ({
        tray: app.moartubeTrayMenu?.getMenuItemById(id).checked,
        window: Menu.getApplicationMenu().getMenuItemById(id).checked,
      }))
    );
  assert.deepEqual(await states(), [
    { tray: true, window: true },
    { tray: true, window: true },
  ]);
  await application.evaluate(({ app }) =>
    app.moartubeTrayMenu.getMenuItemById('autostart').click()
  );
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().getMenuItemById('minimize-on-close').click()
  );
  assert.deepEqual(await states(), [
    { tray: false, window: false },
    { tray: false, window: false },
  ]);
  await application.evaluate(({ app }) =>
    app.moartubeTrayMenu.getMenuItemById('minimize-on-close').click()
  );
  await application.evaluate(({ app }) => app.moartubeRestore());
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return !window.isVisible() || window.isMinimized();
      })
    )
    .toBe(true);
  assert.equal((await fetch(page.url())).status, 200);
  await application.evaluate(({ app }) => app.moartubeRestore());
  url = page.url();
  const userData = await application.evaluate(({ app }) => app.getPath('userData'));
  if (userData !== desktopProfile) throw new Error(`Unexpected desktop data location: ${userData}`);
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
  if (menuFolders[0] !== profile || menuFolders[1] !== path.join(desktopProfile, 'logs'))
    throw new Error('File menu points at an unexpected data/log folder');
  backendPid = await application.evaluate(
    ({ app }) =>
      app.moartubeBackendPid ??
      app.getAppMetrics().find((metric) => metric.name === 'MoarTube Client Backend')?.pid
  );
  if (!Number.isInteger(backendPid)) throw new Error('Managed backend process was not found');
  if (process.platform === 'win32')
    assert.equal(
      await application.evaluate(
        ({ app }, pid) => app.getAppMetrics().some(
          (metric) => metric.pid === pid && metric.name === 'MoarTube Client Backend'
        ),
        backendPid
      ),
      true,
      'Windows Client must run its backend in an Electron utility process'
    );
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
  const before = readFileSync(path.join(profile, '_client_settings.json'), 'utf8');
  await page.reload();
  await page.locator('#sign-in-form').waitFor({ state: 'visible' });
  if (readFileSync(path.join(profile, '_client_settings.json'), 'utf8') !== before)
    throw new Error('Reload changed user settings');
  const second = spawn(
    launchExecutable,
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
    await application.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu().getMenuItemById('minimize-on-close');
      if (item.checked) item.click();
      BrowserWindow.getAllWindows()[0].close();
    });
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
