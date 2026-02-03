import fs from 'node:fs';
// import path from 'node:path';
import { getEnv, type Env } from './env.js';
import { initializePaths, type Paths } from './paths.js';
import { getLogger } from '@/utils/logger.js';
import { z } from 'zod';

// Minimal schema for client settings
const ClientSettingsSchema = z.object({
  clientPort: z.string().or(z.number()).transform(v => Number(v)),
  nodeIp: z.string(),
  nodePort: z.string().or(z.number()).transform(v => Number(v)),
  nodeHttpProtocol: z.string(),
  nodeWebsocketProtocol: z.string(),
  ffmpegPath: z.string().optional(),
  isDeveloperMode: z.boolean().default(false),
  processingAgent: z.object({
      processingAgentType: z.string(),
      processingAgentName: z.string().optional(),
      processingAgentModel: z.string().optional()
  }).optional(),
  videoEncoderSettings: z.record(z.unknown()).optional(),
  liveEncoderSettings: z.record(z.unknown()).optional(),
  version: z.string().optional()
}); //.passthrough(); // TODO: Deprecated, usually default for unknown keys is strip, passthough keeps them.

export type ClientSettings = z.infer<typeof ClientSettingsSchema>;

export interface RuntimeConfig {
  ffmpegPath: string;
}

export class Config {
  private static instance: Config | null = null;
  private readonly _env: Env;
  private readonly _paths: Paths;
  private _clientSettings: ClientSettings;
  private _runtime: RuntimeConfig;
  private _settingsWatcher: fs.FSWatcher | null = null;

  private constructor(baseDir: string, entryPointDir?: string) {
    this._env = getEnv();
    this._paths = initializePaths(baseDir, this._env.isDevelopment, entryPointDir);
    
    // Ensure critical directories
    this.ensureDirectory(this._paths.data);
    this.ensureDirectory(this._paths.videos);
    this.ensureDirectory(this._paths.temp);

    // Load Settings
    this._clientSettings = this.loadClientSettings();

    // Initialize Runtime
    const ffmpegSettingsPath = this._clientSettings.ffmpegPath;
    this._runtime = {
      ffmpegPath: (ffmpegSettingsPath !== undefined && ffmpegSettingsPath !== '') ? ffmpegSettingsPath : 'ffmpeg'
    };

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

    // Hard fallback defaults
    return {
      clientPort: 3000,
      nodeIp: '127.0.0.1',
      nodePort: 3000,
      nodeHttpProtocol: 'http',
      nodeWebsocketProtocol: 'ws',
      isDeveloperMode: false
    };
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

  public get env(): Env { return this._env; }
  public get paths(): Paths { return this._paths; }
  public get clientSettings(): ClientSettings { return this._clientSettings; }
  public get runtime(): RuntimeConfig { return this._runtime; }
  
  public setFfmpegPath(path: string): void {
      this._runtime.ffmpegPath = path;
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
