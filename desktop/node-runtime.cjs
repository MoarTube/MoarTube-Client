const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function verifyNodeRuntime(root, directory, executable = require('electron')) {
  const target = `${process.platform}-${process.arch}`;
  const temporary = path.resolve(root, `build/desktop/work/${target}/preflight`);
  fs.mkdirSync(temporary, { recursive: true });
  const profile = fs.mkdtempSync(path.join(temporary, 'node-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === 'linux') {
    env.ELECTRON_RUN_AS_NODE = '1';
    env.MOARTUBE_CLOUDFLARED_PATH = path.join(
      directory.endsWith('.asar') ? directory + '.unpacked' : directory,
      `resources/cloudflared/${target}/cloudflared`
    );
  }
  try {
    const output = execFileSync(
      executable,
      process.platform === 'linux'
        ? [path.join(directory, 'desktop-preflight.mjs')]
        : [path.join(root, 'desktop/node-preflight.cjs'), path.resolve(directory), profile],
      { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 }
    );
    const result = JSON.parse(output.match(/^MOARTUBE_NODE_PREFLIGHT (.+)$/m)?.[1] ?? 'null');
    if (!result || result.electronVersion !== require('electron/package.json').version)
      throw new Error('Bundled Node Electron runtime preflight failed');
    return result;
  } finally {
    if (path.dirname(profile) !== temporary || !path.basename(profile).startsWith('node-'))
      throw new Error('Invalid Node preflight profile');
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
module.exports = { verifyNodeRuntime };
