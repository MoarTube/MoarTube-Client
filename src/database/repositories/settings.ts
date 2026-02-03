import fs from 'node:fs';
import { BaseService } from '@/services/base.js';
import type { Logger } from '@/utils/logger.js';
import type { Config, ClientSettings } from '@/config/index.js';

// Define the shape of mutable client settings (mirroring _client_settings.json)
export interface ClientSettingsModel {
  clientPort: number;
  nodeIp: string;
  nodePort: number;
  nodeHttpProtocol: 'http' | 'https';
  nodeWebsocketProtocol: 'ws' | 'wss';
  ffmpegPath?: string;
  isDeveloperMode: boolean;
  // Add other fields from _client_settings.json as we discover them
}

export class SettingsRepository extends BaseService {
  private readonly settingsPath: string;
  private readonly config: Config;

  constructor(logger: Logger, config: Config) {
    super('settingsRepository', logger);
    this.config = config;
    this.settingsPath = config.paths.clientSettingsPath;
  }

  public getVideosDirectoryPath(): string {
      return this.config.paths.videos;
  }

  public getTempDirectoryPath(): string {
      return this.config.paths.temp;
  }

  public getClientSettings(): ClientSettings {
      // Direct access to cached settings in Config
      return this.config.clientSettings;
  }

  public async getSettings(): Promise<ClientSettingsModel> {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        // If the primary file doesn't exist, we might have loaded defaults in Config
        // But for repository "read", we try to read the actual file or return the config's loaded version
        // Let's rely on the file system for "freshness" or use the cache in Config if we want
        // But Repository implies data access. 
        if (fs.existsSync(this.config.paths.clientSettingsDefaultPath)) {
             const data = await fs.promises.readFile(this.config.paths.clientSettingsDefaultPath, 'utf-8');
             return JSON.parse(data) as ClientSettingsModel;
        }
        throw new Error('Settings file not found');
      }
      const data = await fs.promises.readFile(this.settingsPath, 'utf-8');
      return JSON.parse(data) as ClientSettingsModel;
    } catch (error) {
      this.logger.error('Failed to read settings', error);
      throw error;
    }
  }

  public async saveSettings(settings: ClientSettingsModel): Promise<void> {
    try {
      await fs.promises.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      this.logger.debug('Client settings saved');
    } catch (error) {
      this.logger.error('Failed to save settings', error);
      throw error;
    }
  }

  public async updateSettings(partial: Partial<ClientSettingsModel>): Promise<ClientSettingsModel> {
      try {
        const current = await this.getSettings();
        const updated = { ...current, ...partial };
        await this.saveSettings(updated);
        return updated;
      } catch (error) {
        this.logger.error('Failed to update settings', error);
        throw error;
      }
  }
}
