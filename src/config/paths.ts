import fs from 'node:fs';
import { componentDirectory } from './data-layout.cjs';
import path from 'node:path';

export interface Paths {
  root: string;
  public: string;
  views: string;
  data: string;
  temp: string;
  dist: string;
  videos: string;
  clientSettingsPath: string;
  clientSettingsDefaultPath: string;
}

export function initializePaths(rootPath: string, entryPointDir?: string): Paths {
  const projectRoot = rootPath;

  // Public assets are copied next to the entry point in a build (dist/public);
  // fall back to the project root's public folder when running from source.
  const entryPublicPath =
    entryPointDir !== undefined ? path.join(entryPointDir, 'public') : undefined;
  const publicPath =
    entryPublicPath !== undefined && fs.existsSync(entryPublicPath)
      ? entryPublicPath
      : path.join(projectRoot, 'public');

  const viewsPath = path.join(publicPath, 'views');
  const distPath = path.join(projectRoot, 'dist');

  const dataPath = componentDirectory('client');
  const tempPath = path.join(dataPath, 'temp');
  const videosPath = path.join(dataPath, 'media', 'videos');

  const clientSettingsPath = path.join(dataPath, '_client_settings.json');
  const clientSettingsDefaultPath = path.join(dataPath, '_client_settings_default.json');

  return {
    root: projectRoot,
    public: publicPath,
    views: viewsPath,
    data: dataPath,
    temp: tempPath,
    dist: distPath,
    videos: videosPath,
    clientSettingsPath,
    clientSettingsDefaultPath,
  };
}
