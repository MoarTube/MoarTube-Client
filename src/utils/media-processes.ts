import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';

const active = new Set<ChildProcess>();
let closing = false;

export function trackMediaProcess(child: ChildProcess | undefined): void {
  if (child === undefined) {
    return;
  }
  active.add(child);
  child.once('close', () => active.delete(child));
  child.once('error', () => active.delete(child));
  if (closing) {
    child.kill();
  }
}

/** Keep all user FFmpeg jobs in one shutdown boundary, including preview jobs. */
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {}
): ChildProcessWithoutNullStreams {
  if (closing) {
    throw new Error('MoarTube Client is shutting down');
  }
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: 'pipe' });
  trackMediaProcess(child);
  return child;
}

export async function stopMediaProcesses(): Promise<void> {
  closing = true;
  await Promise.all(
    [...active].map(
      (child) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 3000);
          child.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
          child.kill();
        })
    )
  );
}
