const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function verifyNodeRuntime(root, directory) {
  const temporary = path.resolve(root, 'build/desktop/work/win32-x64/preflight');
  fs.mkdirSync(temporary, { recursive: true });
  const profile = fs.mkdtempSync(path.join(temporary, 'node-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const output = execFileSync(
      require('electron'),
      [path.join(root, 'desktop/node-preflight.cjs'), path.resolve(directory), profile],
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
