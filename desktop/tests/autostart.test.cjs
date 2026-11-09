const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createAutostart } = require('../autostart.cjs');

function fixture(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-autostart-'));
  t.after(() => {
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir()));
    assert(path.basename(userData).startsWith('moartube-autostart-'));
    fs.rmSync(userData, { recursive: true, force: true });
  });
  let state = { openAtLogin: false, executableWillLaunchAtLogin: false };
  const calls = [];
  const app = {
    getLoginItemSettings(options) {
      assert.deepEqual(options.args, ['--autostart']);
      return state;
    },
    setLoginItemSettings(options) {
      calls.push(options);
      state = { openAtLogin: options.openAtLogin, executableWillLaunchAtLogin: options.enabled };
    },
  };
  return {
    userData,
    app,
    calls,
    platform: 'win32',
    externalDisable() {
      state.executableWillLaunchAtLogin = false;
    },
  };
}
test('Autostart defaults on with hidden-launch arguments and preserves an explicit opt-out', (t) => {
  const options = fixture(t);
  const startup = createAutostart({ ...options, manageLoginItem: true });
  assert.equal(startup.enabled, true);
  assert.equal(options.calls[0].path, process.execPath);
  assert.deepEqual(options.calls[0].args, ['--autostart']);
  startup.setEnabled(false);
  assert.equal(createAutostart({ ...options, manageLoginItem: true }).enabled, false);
  assert.equal(options.calls.length, 2, 'Restart must not re-enable an opted-out application');
});
test('Autostart respects disabling the application in system startup settings', (t) => {
  const options = fixture(t);
  const startup = createAutostart({ ...options, manageLoginItem: true });
  options.externalDisable();
  assert.equal(startup.refresh(), false);
  assert.equal(createAutostart({ ...options, manageLoginItem: true }).enabled, false);
  assert.equal(options.calls.length, 1);
  startup.setEnabled(true);
  assert.equal(startup.enabled, true);
});
test('development and smoke profiles never register test executables for real autostart', (t) => {
  const options = fixture(t);
  const startup = createAutostart({ ...options, manageLoginItem: false });
  assert.equal(startup.enabled, true);
  startup.setEnabled(false);
  assert.equal(createAutostart({ ...options, manageLoginItem: false }).enabled, false);
  assert.deepEqual(options.calls, []);
});

test('Minimize on Close defaults on and persists independently of Autostart', (t) => {
  const options = { ...fixture(t), manageLoginItem: false };
  const settings = createAutostart(options);
  assert.equal(settings.minimizeOnClose, true);
  settings.setMinimizeOnClose(false);
  settings.setEnabled(false);
  const restarted = createAutostart(options);
  assert.equal(restarted.minimizeOnClose, false);
  assert.equal(restarted.enabled, false);
  restarted.setEnabled(true);
  assert.equal(createAutostart(options).minimizeOnClose, false);
});

test('Linux registers each variant separately and respects external disabling', (t) => {
  const fixtureOptions = fixture(t);
  const options = {
    ...fixtureOptions,
    platform: 'linux',
    manageLoginItem: true,
    env: { XDG_CONFIG_HOME: fixtureOptions.userData },
    executable: '/opt/MoarTube $test%/moartube',
  };
  const client = createAutostart({ ...options, appId: 'com.moartube.client' });
  const bundle = createAutostart({
    ...options,
    userData: fs.mkdtempSync(path.join(options.userData, 'bundle-')),
    appId: 'com.moartube.desktop',
  });
  const file = path.join(options.userData, 'autostart/com.moartube.client.desktop');
  assert.equal(client.enabled, true);
  assert.match(fs.readFileSync(file, 'utf8'), /--autostart/);
  assert.match(fs.readFileSync(file, 'utf8'), /\$test%%/);
  client.setEnabled(false);
  assert.equal(bundle.refresh(), true);
  assert.equal(client.refresh(), false);
  client.setEnabled(true);
  fs.appendFileSync(file, 'X-GNOME-Autostart-enabled=false\n');
  assert.equal(client.refresh(), false);
  assert.deepEqual(options.calls, []);
});

test('macOS uses native login settings without Windows arguments', (t) => {
  const options = fixture(t);
  let enabled = false;
  const app = {
    getLoginItemSettings(query) {
      assert.deepEqual(query, {});
      return { openAtLogin: enabled };
    },
    setLoginItemSettings(settings) {
      assert.equal(settings.args, undefined);
      enabled = settings.openAtLogin;
    },
  };
  const settings = createAutostart({ ...options, app, platform: 'darwin', manageLoginItem: true });
  assert.equal(settings.enabled, true);
  settings.setEnabled(false);
  assert.equal(enabled, false);
});
