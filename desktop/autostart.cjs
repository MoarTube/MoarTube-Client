const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const AUTOSTART_ARGUMENT = '--autostart';

function createAutostart({
  app,
  userData,
  manageLoginItem,
  appId = 'com.moartube.desktop',
  platform = process.platform,
  env = process.env,
  executable = process.execPath,
}) {
  const file = path.join(userData, 'desktop-settings.json');
  const options = platform === 'darwin' ? {} : { path: executable, args: [AUTOSTART_ARGUMENT] };
  const linuxFile = path.join(
    env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'autostart',
    `${appId}.desktop`
  );
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved.autostart !== 'boolean') throw new Error('Invalid Autostart preference');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let enabled = saved?.autostart ?? true;
  let minimizeOnClose = typeof saved?.minimizeOnClose === 'boolean' ? saved.minimizeOnClose : true;
  function actualEnabled() {
    if (platform === 'linux') {
      try {
        const entry = fs.readFileSync(linuxFile, 'utf8');
        return (
          !/^Hidden\s*=\s*true\s*$/im.test(entry) &&
          !/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(entry)
        );
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    }
    const state = app.getLoginItemSettings(options);
    return state.openAtLogin && state.executableWillLaunchAtLogin !== false;
  }
  function persist() {
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ ...saved, autostart: enabled, minimizeOnClose, executable }, null, 2) + '\n'
    );
    fs.renameSync(temporary, file);
    saved = { ...saved, autostart: enabled, minimizeOnClose, executable };
  }
  function register(value) {
    if (platform === 'linux') {
      // Desktop Entry values have string escaping in addition to Exec quoting.
      const quoted = '"' + executable.replace(/[%]/g, '%%').replace(/[\\"`$]/g, '\\$&') + '"';
      const exec = quoted.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      fs.mkdirSync(path.dirname(linuxFile), { recursive: true });
      const temporary = `${linuxFile}.tmp-${process.pid}`;
      fs.writeFileSync(
        temporary,
        `[Desktop Entry]\nType=Application\nName=MoarTube\nExec=${exec} ${AUTOSTART_ARGUMENT}\nTerminal=false\nHidden=${!value}\n`
      );
      fs.renameSync(temporary, linuxFile);
    } else
      app.setLoginItemSettings({
        ...options,
        name: appId,
        openAtLogin: value,
        enabled: value,
      });
    enabled = actualEnabled();
    if (enabled !== value) throw new Error('The system could not update Autostart');
  }
  let startupError;
  if (manageLoginItem) {
    try {
      if (saved === undefined || saved.executable !== executable) register(enabled);
      else enabled = actualEnabled(); // Respect changes made in system startup settings.
    } catch (error) {
      startupError = error;
    }
  }
  persist();
  return {
    startupError,
    get enabled() {
      return enabled;
    },
    get minimizeOnClose() {
      return minimizeOnClose;
    },
    setMinimizeOnClose(value) {
      minimizeOnClose = Boolean(value);
      persist();
      return minimizeOnClose;
    },
    refresh() {
      if (manageLoginItem) {
        const actual = actualEnabled();
        if (enabled !== actual) {
          enabled = actual;
          persist();
        }
      }
      return enabled;
    },
    setEnabled(value) {
      if (manageLoginItem) register(value);
      else enabled = value;
      persist();
      return enabled;
    },
  };
}

module.exports = { createAutostart, AUTOSTART_ARGUMENT };
