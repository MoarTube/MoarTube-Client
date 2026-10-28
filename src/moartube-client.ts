import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startClient } from '@/core/client-runtime.js';
import { Logger } from '@/utils/logger.js';

async function start(): Promise<void> {
  // ESM equivalent of __dirname
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const baseDir = path.resolve(__dirname, '..'); // Root

  // Initialize Logger
  const logger = Logger.getInstance();

  try {
    const runtime = await startClient(baseDir, __dirname);
    let stopping = false;
    const shutdown = (): void => {
      if (stopping) {
        return;
      }
      stopping = true;
      void runtime.close().finally(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

await start();
