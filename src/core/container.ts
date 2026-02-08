/**
 * Dependency Injection Container
 */
import { createContainer, asClass, asValue, InjectionMode, type AwilixContainer } from 'awilix';

// Logger
import { Logger } from '@/utils/logger.js';

// Config
import { getConfig } from '@/config/index.js';

// Services
import { SettingsRepository } from '@/database/repositories/settings.js';
import { NodeApiService } from '@/services/node-api.js';
import { S3Service } from '@/services/s3.js';
import { SocketService } from '@/services/socket.js';
import { VideoPublishService } from '@/services/video-publish.js';
import { LiveStreamService } from '@/services/live-stream.js';
import { NodeSocketService } from '@/services/node-socket.js';
import { VideoImportService } from '@/services/video-import.js';
import { StreamsTrackerService } from '@/services/streams-tracker.js';
import { ManifestService } from '@/services/manifest.js';
import { FfmpegService } from '@/services/ffmpeg.js';

/**
 * Container cradle type - defines all registered dependencies
 */
export interface ContainerCradle {
  // Core
  logger: Logger;
  config: ReturnType<typeof getConfig>;

  // Repositories
  settingsRepository: SettingsRepository;

  // Services
  nodeApiService: NodeApiService;
  s3Service: S3Service;
  socketService: SocketService;
  videoPublishService: VideoPublishService;
  liveStreamService: LiveStreamService;
  nodeSocketService: NodeSocketService;
  videoImportService: VideoImportService;
  streamsTrackerService: StreamsTrackerService;
  manifestService: ManifestService;
  ffmpegService: FfmpegService;
}

export type Container = AwilixContainer<ContainerCradle>;

/**
 * Create and configure DI container
 */
export function createAppContainer(): Promise<Container> {
  const container = createContainer<ContainerCradle>({
    injectionMode: InjectionMode.CLASSIC, 
  });

  const config = getConfig();
  const logger = Logger.getInstance();

  container.register({
    logger: asValue(logger),
    config: asValue(config),
  });

  // Register Repositories
  container.register({
      settingsRepository: asClass(SettingsRepository).singleton()
  });

  // Register Services
  container.register({
      nodeApiService: asClass(NodeApiService).singleton(),
      s3Service: asClass(S3Service).singleton(),
      socketService: asClass(SocketService).singleton(),
      videoPublishService: asClass(VideoPublishService).singleton(),
      liveStreamService: asClass(LiveStreamService).singleton(),
      nodeSocketService: asClass(NodeSocketService).singleton(),
      videoImportService: asClass(VideoImportService).singleton(),
      streamsTrackerService: asClass(StreamsTrackerService).singleton(),
      manifestService: asClass(ManifestService).singleton(),
      ffmpegService: asClass(FfmpegService).singleton(),
  });

  return Promise.resolve(container);
}


