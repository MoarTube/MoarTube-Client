import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const environment = { ...process.env };
// Some editors launch tasks with this set; the desktop must run Electron, not Node.
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, 'desktop/main.cjs')], {
  cwd: root,
  env: environment,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
