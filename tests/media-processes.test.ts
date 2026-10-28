import { expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { execFile } from 'node:child_process';

it('stops owned media processes and prevents new jobs after shutdown', async () => {
  vi.resetModules();
  const { spawnMediaProcess, stopMediaProcesses, trackMediaProcess } =
    await import('../src/utils/media-processes.js');
  const child = spawnMediaProcess(process.execPath, [
    '-e',
    "console.log('ready'); setInterval(() => {}, 1000)",
  ]);
  const probe = execFile(
    process.execPath,
    ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
    { windowsHide: true },
    () => {}
  );
  trackMediaProcess(probe);
  try {
    if (probe.stdout === null) {
      throw new Error('Probe stdout was not piped');
    }
    await Promise.all([once(child.stdout, 'data'), once(probe.stdout, 'data')]);
    const closed = once(child, 'close');
    const probeClosed = once(probe, 'close');
    await stopMediaProcesses();
    await closed;
    await probeClosed;
    expect(() => spawnMediaProcess(process.execPath, ['-v'])).toThrow('shutting down');
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    if (probe.exitCode === null) {
      probe.kill('SIGKILL');
    }
  }
});
