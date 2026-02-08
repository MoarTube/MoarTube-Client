/**
 * FFmpeg Service
 *
 * Single source of truth for the FFmpeg executable path.
 * Resolves the path using the following priority:
 *   1. Client settings (`ffmpegPath` in _client_settings.json)
 *   2. Bundled ffmpeg-static binary
 *   3. System PATH fallback (`ffmpeg`)
 *
 * Legacy equivalent: helpers.js getFfmpegPath / setFfmpegPath
 */
import ffmpegStatic from 'ffmpeg-static';
import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { Config } from '@/config/index.js';

export class FfmpegService extends BaseService {
  private readonly config: Config;

  constructor(logger: Logger, config: Config) {
    super('ffmpegService', logger);
    this.config = config;
  }

  /**
   * Get the resolved FFmpeg executable path.
   *
   * Re-evaluated on every call so that a settings-file change
   * (picked up by Config's file watcher) takes effect immediately.
   */
  public getPath(): string {
    // 1. Explicit path from client settings
    const settingsPath = this.config.clientSettings.ffmpegPath;
    if (settingsPath !== undefined && settingsPath !== '') {
      return settingsPath;
    }

    // 2. Bundled ffmpeg-static binary
    const staticPath = ffmpegStatic as unknown as string | null;
    if (staticPath !== null) {
      return staticPath;
    }

    // 3. System PATH fallback
    return 'ffmpeg';
  }
}
