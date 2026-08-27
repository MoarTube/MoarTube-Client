import fs from 'node:fs';
// import path from 'node:path';
import { initializePaths, type Paths } from './paths.js';
import { getLogger } from '@/utils/logger.js';
import { z } from 'zod';
import { DEFAULT_CLIENT_SETTINGS } from './defaults.js';

// Minimal schema for client settings
const ClientSettingsSchema = z.object({
  clientPort: z.string().or(z.number()).transform(Number),
  nodeIp: z.string(),
  nodePort: z.string().or(z.number()).transform(Number),
  nodeHttpProtocol: z.string(),
  nodeWebsocketProtocol: z.string(),
  ffmpegPath: z.string().optional(),
  processingAgent: z
    .object({
      processingAgentType: z.string(),
      processingAgentName: z.string().optional(),
      processingAgentModel: z.string().optional(),
    })
    .optional(),
  videoEncoderSettings: z.record(z.string(), z.unknown()).optional(),
  liveEncoderSettings: z.record(z.string(), z.unknown()).optional(),
  version: z.string().optional(),
});

export type ClientSettings = z.infer<typeof ClientSettingsSchema>;

export class Config {
  private static instance: Config | null = null;
  private readonly _paths: Paths;
  private _clientSettings: ClientSettings;
  private _settingsWatcher: fs.FSWatcher | null = null;

  private constructor(baseDir: string, entryPointDir?: string) {
    this._paths = initializePaths(baseDir, entryPointDir);

    // Ensure critical directories
    this.ensureDirectory(this._paths.data);
    this.ensureDirectory(this._paths.videos);
    this.ensureDirectory(this._paths.temp);

    // Load Settings
    this._clientSettings = this.loadClientSettings();

    this.setupSettingsFileWatcher();
  }

  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private loadClientSettings(): ClientSettings {
    try {
      if (fs.existsSync(this._paths.clientSettingsPath)) {
        const content = fs.readFileSync(this._paths.clientSettingsPath, 'utf8');
        const parsed: unknown = JSON.parse(content);
        return ClientSettingsSchema.parse(parsed);
      }

      // Fallback to default if exists
      if (fs.existsSync(this._paths.clientSettingsDefaultPath)) {
        const content = fs.readFileSync(this._paths.clientSettingsDefaultPath, 'utf8');
        const parsed: unknown = JSON.parse(content);
        return ClientSettingsSchema.parse(parsed);
      }
    } catch (error) {
      getLogger().error('Failed to load client settings', error);
    }

    // Hard fallback: Generate default settings files
    try {
      const defaultContent = JSON.stringify(DEFAULT_CLIENT_SETTINGS, null, 2);

      fs.writeFileSync(this._paths.clientSettingsDefaultPath, defaultContent, 'utf8');
      fs.writeFileSync(this._paths.clientSettingsPath, defaultContent, 'utf8');

      getLogger().info(`Generated default client settings at ${this._paths.clientSettingsPath}`);
      return DEFAULT_CLIENT_SETTINGS;
    } catch (writeError) {
      getLogger().error('Failed to generate default client settings', writeError);
    }

    // In-memory fallback if write fails
    return DEFAULT_CLIENT_SETTINGS;
  }

  private setupSettingsFileWatcher(): void {
    try {
      if (fs.existsSync(this._paths.clientSettingsPath)) {
        this._settingsWatcher = fs.watch(this._paths.clientSettingsPath, (eventType) => {
          if (eventType === 'change') {
            getLogger().info('Client settings file changed, reloading...');
            this._clientSettings = this.loadClientSettings();
          }
        });
      }
    } catch (e) {
      getLogger().warn('Could not setup settings file watcher', e);
    }
  }

  public stopWatching(): void {
    if (this._settingsWatcher) {
      this._settingsWatcher.close();
    }
  }

  public get paths(): Paths {
    return this._paths;
  }
  public get clientSettings(): ClientSettings {
    return this._clientSettings;
  }

  public saveClientSettings(settings: Partial<ClientSettings>): void {
    // Merge updates
    const updatedSettings = { ...this._clientSettings, ...settings };

    try {
      fs.writeFileSync(this._paths.clientSettingsPath, JSON.stringify(updatedSettings, null, 4));
      this._clientSettings = updatedSettings; // Update memory immediately
      getLogger().info('Client settings saved successfully.');
    } catch (error) {
      getLogger().error('Failed to save client settings', error);
      throw error;
    }
  }

  public static initialize(baseDir: string, entryPointDir?: string): Config {
    Config.instance ??= new Config(baseDir, entryPointDir);
    return Config.instance;
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      throw new Error('Config not initialized. Call initialize() first.');
    }
    return Config.instance;
  }
}

export function initializeConfig(baseDir: string, entryPointDir?: string): Config {
  return Config.initialize(baseDir, entryPointDir);
}

export function getConfig(): Config {
  return Config.getInstance();
}
