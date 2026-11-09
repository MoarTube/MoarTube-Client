import type { FastifyInstance } from 'fastify';
import { initializeConfig } from '@/config/index.js';
import { createAppContainer, type Container } from '@/core/container.js';
import { createFastifyApp } from '@/plugins/index.js';
import { Logger } from '@/utils/logger.js';
import { LifecycleManager } from '@/core/lifecycle.js';
import { stopMediaProcesses } from '@/utils/media-processes.js';
import { prepareData } from '@/config/data-layout.cjs';

export interface ClientRuntime {
  url: string;
  close: () => Promise<void>;
}

export async function startClient(
  root: string,
  entryPointDir: string,
  desktop = false
): Promise<ClientRuntime> {
  const releaseData = await prepareData('client');
  process.once('exit', releaseData);
  let config;
  try {
    config = initializeConfig(root, entryPointDir);
  } catch (error) {
    process.removeListener('exit', releaseData);
    releaseData();
    throw error;
  }
  let container: Container | undefined;
  let app: FastifyInstance | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    config.stopWatching();
    if (container !== undefined) {
      container.resolve('videoPublishService').close();
      container.resolve('videoImportService').close();
      container.resolve('liveStreamService').close();
      container.resolve('nodeSocketService').disconnect();
      container.resolve('nodeApiService').close();
      container.resolve('s3Service').close();
      container.resolve('socketService').close();
    }
    await stopMediaProcesses();
    await app?.close();
    await container?.dispose();
    process.removeListener('exit', releaseData);
    releaseData();
  };
  try {
    container = await createAppContainer();
    app = await createFastifyApp(container);
    if (desktop) {
      app.addHook('onSend', (_request, reply, payload, done) => {
        // Share previews embed the selected Node's HTTP(S) player, including tunnels.
        reply.header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data: http: https:; media-src 'self' blob: http: https:; font-src 'self' data:; object-src 'none'; frame-src http: https:; base-uri 'self'; form-action 'self'"
        );
        done(null, payload);
      });
    }
    const lifecycle = new LifecycleManager(container);
    await lifecycle.onStartup(desktop);
    const url = await app.listen({
      port: desktop ? 0 : config.clientSettings.clientPort,
      host: config.clientSettings.allowRemoteConnections ? '0.0.0.0' : '127.0.0.1',
    });
    Logger.getInstance().info(`Server listening on ${url}`);
    return { url, close };
  } catch (error) {
    await close();
    throw error;
  }
}
