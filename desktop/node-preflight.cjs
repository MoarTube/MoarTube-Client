// Build-time Electron host: no application windows or installed user profiles.
const { app, utilityProcess } = require('electron');
const path = require('node:path');
const directory = process.argv[2];
app.setPath('userData', process.argv[3]);
app.whenReady().then(() => {
  const child = utilityProcess.fork(path.join(directory, 'desktop-preflight.mjs'), [], {
    env: {
      ...process.env,
      MOARTUBE_CLOUDFLARED_PATH: path.join(
        directory.endsWith('.asar') ? directory + '.unpacked' : directory,
        'resources/cloudflared/win32-x64/cloudflared.exe'
      ),
    },
    stdio: 'pipe',
    serviceName: 'MoarTube Node Build Check',
  });
  let verified = false;
  const timer = setTimeout(() => {
    child.kill();
    app.exit(1);
  }, 20_000);
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  child.once('message', (message) => {
    verified = true;
    console.log('MOARTUBE_NODE_PREFLIGHT ' + JSON.stringify(message));
    child.kill();
  });
  child.once('exit', () => {
    clearTimeout(timer);
    app.exit(verified ? 0 : 1);
  });
});
