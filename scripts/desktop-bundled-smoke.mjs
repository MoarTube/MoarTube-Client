import { _electron } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopPaths } from '../tooling/build-paths.cjs';

if (!['win32', 'linux'].includes(process.platform))
  throw new Error('Bundled smoke requires Windows or Linux.');
const root = fileURLToPath(new URL('../', import.meta.url));
const layout = desktopPaths(root, `${process.platform}-${process.arch}`);
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const launchExecutable = executablePath ?? (await import('electron')).default;
const mode = executablePath ? 'packaged' : 'development';
const profile = path.join(layout.profiles, `bundled-smoke-${mode}-${Date.now()}`);
const report = path.join(layout.reports, `bundled-${mode}`);
const dataBase = path.join(profile, 'MoarTube/client_node');
const userData = path.join(dataBase, 'client/desktop');
const nodeSettings = path.join(dataBase, 'node/_node_settings.json');
const previousPort = existsSync(nodeSettings)
  ? JSON.parse(readFileSync(nodeSettings, 'utf8')).nodeListeningPort
  : undefined;
mkdirSync(report, { recursive: true });
const markers = [
  'client/media/videos/desktop-smoke/source/keep.txt',
  'node/media/videos/desktop-smoke/source/keep.txt',
];
for (const marker of markers) {
  const file = path.join(dataBase, marker);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'preserved desktop media');
}
// Saved preferences cannot redirect a bundled Client to another Node.
writeFileSync(
  path.join(dataBase, 'client/_client_settings.json'),
  JSON.stringify({ nodeIp: '203.0.113.1', nodePort: 1 })
);
const environment = {
  ...process.env,
  MOARTUBE_DESKTOP_BUNDLED: '1',
  MOARTUBE_DESKTOP_SMOKE: '1',
  MOARTUBE_DESKTOP_TEST_DATA_DIR: profile,
};
delete environment.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({
  chromiumSandbox: true,
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [path.join(root, 'desktop/main.cjs')]), '--autostart'],
  env: environment,
  timeout: 30_000,
});
application.process().stderr?.on('data', (chunk) => process.stderr.write(chunk));
let url;
let applicationClosed = false;
application.on('close', () => {
  applicationClosed = true;
});
let pids = [];
let nodePort;
const credentials = { username: 'desktop-test-user', password: randomBytes(16).toString('hex') };
async function saveCredentials(page, username, password) {
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/settings`);
  await page.waitForLoadState('networkidle');
  await page.locator('#username-input').fill(username);
  await page.locator('#password-input').fill(password);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/settings/node/account') && response.request().method() === 'POST'
  );
  await page.locator('#account_credentials_settings_form button[type="submit"]').click();
  assert.equal((await (await saved).json()).isError, false);
  await page.locator('.swal2-success').waitFor({ state: 'visible' });
  await page.locator('.swal2-container').waitFor({ state: 'hidden' });
}
const errors = [];
try {
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForURL(/\/videos$/, { timeout: 180_000 });
  await page.waitForLoadState('networkidle');
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false
  );
  assert.equal(
    await application.evaluate(({ app }) => app.moartubeWindowShowCount),
    0,
    'Autostart must never show the window during initialization'
  );
  const menuState = () =>
    application.evaluate(({ app, Menu }) => ({
      tray: app.moartubeTrayMenu.getMenuItemById('autostart').checked,
      window: Menu.getApplicationMenu().getMenuItemById('autostart').checked,
    }));
  assert.deepEqual(await menuState(), { tray: true, window: true });
  assert.equal(
    await application.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('minimize-on-close').checked
    ),
    true
  );
  await application.evaluate(({ app }) =>
    app.moartubeTrayMenu.getMenuItemById('minimize-on-close').click()
  );
  assert.equal(
    await application.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('minimize-on-close').checked
    ),
    false
  );
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().getMenuItemById('minimize-on-close').click()
  );
  await application.evaluate(({ app }) => {
    const item = app.moartubeTrayMenu.getMenuItemById('autostart');
    item.click();
  });
  assert.deepEqual(await menuState(), { tray: false, window: false });
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().getMenuItemById('autostart');
    item.click();
  });
  assert.deepEqual(await menuState(), { tray: true, window: true });
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().getMenuItemById('autostart');
    item.click();
  });
  assert.equal(
    JSON.parse(readFileSync(path.join(userData, 'desktop-settings.json'))).autostart,
    false
  );
  await application.evaluate(({ app }) =>
    app.moartubeTrayMenu.items.find((item) => item.label === 'Open MoarTube').click()
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    true
  );
  url = new URL(page.url()).origin;
  assert.equal(await page.locator('#sign-in-form').count(), 0);
  assert.equal(await page.locator('a[href="/account/signout"]').count(), 0);
  const owned = await application.evaluate(({ app }) => ({
    node: app.moartubeNodePid,
    client: app.moartubeBackendPid,
    port: app.moartubeNodePort,
  }));
  nodePort = owned.port;
  assert(Number.isInteger(owned.node) && Number.isInteger(owned.client));
  if (previousPort !== undefined)
    assert.equal(owned.port, previousPort, 'Restart must retain the owned Node listening port');
  assert.equal(
    (await fetch(`${url}/videos`)).status,
    403,
    'Auto-admin must require the private Electron session'
  );
  await page.goto(`${url}/settings`);
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#account_credentials_settings_form').count(), 1);
  assert.equal(await page.locator('#internal_network_settings_form').count(), 0);
  assert.equal(await page.locator('#node-setting-secure-mode-checkbox').count(), 0);
  const blocked = await page.evaluate(async () => {
    const result = [];
    for (const endpoint of ['/settings/node/network/internal', '/settings/node/secure']) {
      result.push(
        (
          await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status
      );
    }
    return result;
  });
  assert.deepEqual(blocked, [403, 403]);
  await page.goto(`${url}/account/signout`);
  assert.equal(new URL(page.url()).pathname, '/videos');
  await page.reload();
  await page.waitForLoadState('networkidle');
  const security = await application.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: prefs.sandbox,
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration,
    };
  });
  const sandboxState = await application.evaluate(({ app, BrowserWindow }) => {
    let kernelSandbox;
    if (process.platform === 'linux') {
      const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId();
      const status = process
        .getBuiltinModule('node:fs')
        .readFileSync('/proc/' + pid + '/status', 'utf8');
      kernelSandbox = {
        seccomp: Number(status.match(/^Seccomp:\s+(\d+)/m)?.[1]),
        noNewPrivs: Number(status.match(/^NoNewPrivs:\s+(\d+)/m)?.[1]),
      };
    }
    return { chromiumSandbox: !app.commandLine.hasSwitch('no-sandbox'), kernelSandbox };
  });
  assert.equal(sandboxState.chromiumSandbox, true);
  if (sandboxState.kernelSandbox)
    assert.deepEqual(sandboxState.kernelSandbox, { seccomp: 2, noNewPrivs: 1 });
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect
    .poll(() =>
      application.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible() &&
          !BrowserWindow.getAllWindows()[0].isMinimized()
      )
    )
    .toBe(false);
  assert.equal(
    (await fetch(`${url}/videos`)).status,
    403,
    'Closing the window must keep the Client running'
  );
  assert.equal(
    (await fetch(`http://127.0.0.1:${owned.port}/status/heartbeat`, { redirect: 'error' })).status,
    200
  );
  await application.evaluate(({ app }) => app.moartubeRestore());
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    true
  );
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const background = spawn(
    launchExecutable,
    [...(executablePath ? [] : [path.join(root, 'desktop/main.cjs')]), '--autostart'],
    {
      env: environment,
      windowsHide: true,
      stdio: 'ignore',
    }
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      background.kill();
      reject(new Error('Background duplicate did not exit'));
    }, 10_000);
    background.once('error', reject);
    background.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Background instance exit ${code}`));
    });
  });
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false
  );
  const second = spawn(
    launchExecutable,
    executablePath ? [] : [path.join(root, 'desktop/main.cjs')],
    {
      env: environment,
      windowsHide: true,
      stdio: 'ignore',
    }
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('Second instance did not exit'));
    }, 10_000);
    second.once('error', reject);
    second.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Second instance exit ${code}`));
    });
  });
  const manualOpened = await application.evaluate(async ({ BrowserWindow }) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (BrowserWindow.getAllWindows()[0].isVisible()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  });
  assert.equal(
    manualOpened,
    true,
    JSON.stringify(await application.evaluate(({ app }) => app.moartubeLastLaunch))
  );
  // Snapshot owned process descendants, including workers and Cloudflared.
  const processes =
    process.platform === 'linux'
      ? readdirSync('/proc')
          .filter((name) => /^\d+$/.test(name))
          .flatMap((name) => {
            try {
              const stat = readFileSync('/proc/' + name + '/stat', 'utf8');
              return [
                {
                  ProcessId: Number(name),
                  ParentProcessId: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]),
                },
              ];
            } catch {
              return [];
            }
          })
      : JSON.parse(
          execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
            ],
            { encoding: 'utf8', windowsHide: true }
          )
        );
  pids = [owned.node, owned.client];
  for (let i = 0; i < pids.length; i++) {
    for (const child of processes.filter((p) => p.ParentProcessId === pids[i]))
      if (!pids.includes(child.ProcessId)) pids.push(child.ProcessId);
  }
  for (const marker of markers)
    assert.equal(readFileSync(path.join(dataBase, marker), 'utf8'), 'preserved desktop media');
  assert.deepEqual(errors, [], 'Renderer errors');
  await page.screenshot({ path: path.join(report, 'window.png') });
  await saveCredentials(page, credentials.username, credentials.password);
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().getMenuItemById('minimize-on-close').click()
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(dataBase, 'client/_client_settings.json')))
      .bundledNodeLoginRequired,
    true
  );
  assert(
    !readFileSync(path.join(dataBase, 'client/_client_settings.json'), 'utf8').includes(
      credentials.password
    )
  );
  assert(!readFileSync(nodeSettings, 'utf8').includes(credentials.password));
  // Saving credentials must leave the current session active until restart.
  await page.goto(`${url}/videos`);
  await page.waitForURL(/\/videos$/);
  writeFileSync(
    path.join(report, 'smoke.json'),
    JSON.stringify(
      {
        mode,
        url,
        owned,
        pids,
        security,
        sandbox: security.sandbox,
        contextIsolation: security.contextIsolation,
        ...sandboxState,
        mediaPreserved: true,
        trayClose: true,
        autoAdmin: true,
      },
      null,
      2
    )
  );
} finally {
  if (!applicationClosed) {
    const closed = application.waitForEvent('close', { timeout: 30_000 });
    await application.evaluate(({ app }) => app.quit());
    await closed;
  }
}
for (const pid of pids) {
  assert.throws(
    () => process.kill(pid, 0),
    { code: 'ESRCH' },
    `Owned process ${pid} survived Quit`
  );
}
if (url) await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }));
console.log(
  `Bundled ${mode} smoke passed: auto-admin, fixed Node, tray close/restore, media preservation, single instance and process cleanup.`
);

// Exercise the same persistent profile across manual-login and automatic-login restarts.
for (const manual of [true, false]) {
  const restarted = await _electron.launch({
    chromiumSandbox: true,
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [path.join(root, 'desktop/main.cjs')]), '--autostart'],
    env: environment,
    timeout: 30_000,
  });
  let closed = false;
  restarted.on('close', () => {
    closed = true;
  });
  let owned;
  try {
    const page = await restarted.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForURL(manual ? /\/account\/signin$/ : /\/videos$/, { timeout: 180_000 });
    await page.waitForLoadState('networkidle');
    assert.equal(await restarted.evaluate(({ app }) => app.moartubeWindowShowCount), 0);
    assert.equal(
      await restarted.evaluate(
        ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('minimize-on-close').checked
      ),
      false,
      'Minimize on Close opt-out must survive restart'
    );
    assert.equal(
      await restarted.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      false
    );
    assert.deepEqual(
      await restarted.evaluate(({ app, Menu }) => ({
        tray: app.moartubeTrayMenu.getMenuItemById('autostart').checked,
        window: Menu.getApplicationMenu().getMenuItemById('autostart').checked,
      })),
      { tray: false, window: false },
      'Autostart opt-out must survive restart'
    );
    await restarted.evaluate(({ app }) =>
      app.moartubeTrayMenu.items.find((item) => item.label === 'Open MoarTube').click()
    );
    owned = await restarted.evaluate(({ app }) => ({
      node: app.moartubeNodePid,
      client: app.moartubeBackendPid,
      port: app.moartubeNodePort,
    }));
    assert.equal(owned.port, nodePort);
    if (manual) {
      assert.equal(
        await page
          .locator(
            '#signin-address, #signin-port, #new-node-favorite, #node-favorite-editor, script[src="/javascript/node-favorites.js"]'
          )
          .count(),
        0
      );
      const rejected = await page.evaluate(async ({ username }) => {
        const response = await fetch('/account/signin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password: 'incorrect',
            moarTubeNodeIp: '203.0.113.1',
            moarTubeNodePort: 1,
          }),
        });
        return response.json();
      }, credentials);
      assert.equal(rejected.isAuthenticated, false);
      async function login() {
        await page.locator('#signin-username').fill(credentials.username);
        await page.locator('#signin-password').fill(credentials.password);
        await page.locator('#sign-in-button').click();
        await page.waitForURL(/\/videos$/);
      }
      await login();
      assert.equal(await page.locator('a[href="/account/signout"]').count(), 1);
      await page.goto(new URL('/account/signout', page.url()).href);
      await page.waitForURL(/\/account\/signin$/);
      await login();
      const invalid = await page.evaluate(
        async () =>
          (
            await fetch('/settings/node/account', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: '', password: 'partial' }),
            })
          ).status
      );
      assert.equal(invalid, 400);
      await saveCredentials(page, '', '');
      assert.equal(
        JSON.parse(readFileSync(path.join(dataBase, 'client/_client_settings.json')))
          .bundledNodeLoginRequired,
        false
      );
      await page.goto(new URL('/videos', page.url()).href);
      assert.equal(
        await page.locator('a[href="/account/signout"]').count(),
        1,
        'Mode changes apply on next start'
      );
    } else {
      assert.equal(await page.locator('#sign-in-form, a[href="/account/signout"]').count(), 0);
      for (const marker of markers)
        assert.equal(readFileSync(path.join(dataBase, marker), 'utf8'), 'preserved desktop media');
    }
  } finally {
    if (!closed) {
      const stopped = restarted.waitForEvent('close', { timeout: 30_000 });
      await restarted.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await stopped;
    }
  }
  if (owned)
    for (const pid of [owned.node, owned.client])
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}
assert.deepEqual(errors, []);
console.log(
  'Hidden autostart, synchronized tray/window toggles, persistent opt-out, manual restore and credential-mode restarts passed.'
);
