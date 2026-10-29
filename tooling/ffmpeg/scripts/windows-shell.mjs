import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

// MSYS2 can truncate long -lc arguments on Windows. Keep shell source in a file
// and pass only its short path through the Windows process command line.
export async function runMsysScript(
  bash,
  command,
  { cwd, directory, env = process.env, stdio = 'inherit' }
) {
  const base = path.resolve(directory);
  await mkdir(base, { recursive: true });
  const temporary = await mkdtemp(path.join(base, 'shell-'));
  const script = path.join(temporary, 'command.sh');
  const argument = script
    .replaceAll('\\', '/')
    .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
  await writeFile(script, `#!/usr/bin/env bash\nset -euo pipefail\n${command}\n`, 'utf8');
  // Failed runs keep the exact script for diagnostics; only successful runs
  // reach the cleanup below.
  await new Promise((resolve, reject) => {
    const child = spawn(bash, ['-l', argument], {
      cwd,
      windowsHide: true,
      stdio,
      env: { ...env, MSYSTEM: 'CLANG64', CHERE_INVOKING: '1', MSYS2_PATH_TYPE: 'minimal' },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${bash} failed (${signal ?? code}); script retained: ${script}`))
    );
  });
  if (path.dirname(temporary) !== base || !path.basename(temporary).startsWith('shell-'))
    throw new Error('Refusing to remove an unexpected shell script directory');
  await rm(temporary, { recursive: true, force: true });
}
