import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeConfig, getConfig } from '@/config/index.js';
import { createAppContainer } from '@/core/container.js';
import { createFastifyApp } from '@/plugins/index.js';
import { Logger } from '@/utils/logger.js';
import { registerRoutes } from '@/routes/index.js';
import { LifecycleManager } from '@/core/lifecycle.js';

async function start() {
  // ESM equivalent of __dirname
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const baseDir = path.resolve(__dirname, '..'); // Root

  // Initialize Config
  initializeConfig(baseDir, __dirname);
  const config = getConfig();

  // Initialize Logger
  const logger = Logger.getInstance({
      level: config.env.isDevelopment ? 'debug' : 'info' as any
  });

  try {
    // Create Container
    const container = await createAppContainer();

    // Create App
    const app = await createFastifyApp(container);

    // Register Routes
    registerRoutes(app, container);

    // Lifecycle Startup (Background tasks, assessments)
    const lifecycle = new LifecycleManager(container);
    await lifecycle.onStartup();

    // Start Server
    const port = config.clientSettings.clientPort;
    const host = '0.0.0.0';

    await app.listen({ port, host });
    
    logger.info(`Server listening on ${host}:${port}`);
    logger.info(`Environment: ${config.env.nodeEnv}`);
    
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

await start();