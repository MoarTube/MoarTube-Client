import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startClient, type ClientRuntime } from '@/core/client-runtime.js';
import { stopMediaProcesses } from '@/utils/media-processes.js';

interface ParentPort {
  on(event: string, handler: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}
// Linux/macOS use a bundled standalone Node process. This isolates native
// dependencies from Electron; Windows retains its utility-process port.
const nodeParent: ParentPort | undefined =
  process.env['MOARTUBE_DESKTOP_NODE_BACKEND'] === '1' &&
  process.versions['electron'] === undefined &&
  process.connected &&
  process.send !== undefined
    ? {
        on(event, handler): void {
          if (event === 'message') {
            process.on('message', (data): void => {
              handler({ data });
            });
          } else if (event === 'close') {
            process.on('disconnect', (): void => {
              handler({ data: undefined });
            });
          }
        },
        postMessage(message): void {
          process.send?.(message as object);
        },
      }
    : undefined;
const parent = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort ?? nodeParent;
if (parent === undefined) {
  throw new Error('The desktop backend must be launched by the desktop application');
}
let runtime: ClientRuntime | undefined;
const state = { stopping: false };
async function shutdown(): Promise<void> {
  if (state.stopping) {
    return;
  }
  state.stopping = true;
  if (runtime !== undefined) {
    await runtime.close();
    process.exit(0);
  }
  await stopMediaProcesses();
}
parent.on('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'shutdown') {
    void shutdown();
  }
});
parent.on('close', () => {
  void shutdown();
});
try {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  runtime = await startClient(path.resolve(directory, '..'), directory, true);
  if (state.stopping) {
    await runtime.close();
    process.exit(0);
  } else {
    parent.postMessage({ type: 'ready', url: runtime.url });
  }
} catch (error) {
  parent.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exit(1);
}
