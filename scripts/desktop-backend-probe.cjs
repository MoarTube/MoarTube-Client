// Test the bundled Node runtime and real backend IPC separately from Chromium.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, fork } = require('node:child_process');
const { createHash } = require('node:crypto');

async function main() {
  const resources = path.resolve(process.argv[2]);
  const target = `${process.platform}-${process.arch}`;
  const directory = path.resolve(`build/desktop/reports/${target}`);
  fs.mkdirSync(directory, { recursive: true });
  const profile = path.resolve(`build/desktop/profiles/${target}/backend-node`);
  const app = path.join(resources, process.versions.electron ? 'app.asar' : 'app.asar.unpacked');
  execFileSync(process.execPath, [path.join(__dirname, 'desktop-image-probe.cjs'), resources], {
    env: { ...process.env },
    stdio: 'inherit',
    timeout: 120000,
    windowsHide: true,
  });
  const runtime = path.join(resources, 'ffmpeg', target);
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8'));
  if (manifest.target !== target) throw new Error('Packaged FFmpeg architecture mismatch');
  for (const name of ['ffmpeg', 'ffprobe']) {
    const file = path.join(runtime, manifest.files[name].path);
    if (
      createHash('sha256').update(fs.readFileSync(file)).digest('hex') !==
      manifest.files[name].sha256
    )
      throw new Error(`Checksum mismatch: ${name}`);
    execFileSync(file, ['-version'], { timeout: 30000, stdio: 'ignore' });
  }
  for (const stopMethod of ['shutdown', 'disconnect']) {
    const child = fork(path.join(app, 'dist/desktop-backend.js'), [], {
      execPath: process.execPath,
      execArgv: [],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        MOARTUBE_DATA_DIR: path.join(profile, 'client'),
        MOARTUBE_RESOURCE_ROOT: resources,
        MOARTUBE_DESKTOP_MODE: 'packaged',
        MOARTUBE_DESKTOP_NODE_BACKEND: '1',
        FFMPEG_BIN: '',
      },
    });
    let backendUrl;
    try {
      await new Promise((resolve, reject) => {
        let verified = false;
        const timer = setTimeout(
          () => reject(new Error('Packaged backend probe timed out')),
          120000
        );
        child.once('error', reject);
        child.once('exit', (code) => {
          clearTimeout(timer);
          if (code === 0 && verified) resolve();
          else reject(new Error(`Backend exited ${code} before successful shutdown`));
        });
        child.on(
          'message',
          (message) =>
            void (async () => {
              if (message.type === 'error') throw new Error(message.message);
              if (message.type !== 'ready') return;
              const url = new URL('/account/signin', message.url);
              if (url.hostname !== '127.0.0.1') throw new Error('Backend did not bind loopback');
              const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
              if (!response.ok || !(await response.text()).includes('sign-in-form'))
                throw new Error('Packaged sign-in page failed');
              backendUrl = url.href;
              verified = true;
              if (stopMethod === 'shutdown') child.send({ type: 'shutdown' });
              else child.disconnect();
            })().catch(reject)
        );
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    try {
      await fetch(backendUrl, { signal: AbortSignal.timeout(2000) });
      throw new Error('Backend listener survived shutdown');
    } catch (error) {
      if (error.message === 'Backend listener survived shutdown') throw error;
    }
  }
  fs.writeFileSync(
    path.join(directory, 'backend-probe.json'),
    JSON.stringify(
      {
        target,
        node: process.version,
        imagePipeline: 'WASM normalization + FFmpeg',
        ffmpegBuildId: manifest.buildId,
        softwareImagePipeline: 'passed',
        backendHttp: 'passed',
        ipcShutdown: 'passed',
        parentDisconnectShutdown: 'passed',
        scope:
          'Packaged Client backend and real child IPC; renderer/sandbox qualification is separate',
      },
      null,
      2
    ) + '\n'
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
