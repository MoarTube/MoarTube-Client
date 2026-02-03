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

export function initializePaths(rootPath: string, isDevelopment: boolean, entryPointDir?: string): Paths {
  // If running from dist (entryPointDir provided), use that to resolve public/views
  const currentRoot = entryPointDir ?? rootPath;
  
  // In dev specific paths might differ if we want to run from src but use data from root
  const projectRoot = isDevelopment ? path.resolve(currentRoot, '..') : rootPath; 

  // In development, public is in the project root. In production (dist), it's relative to the entry script (dist/public)
  const rootForAssets = isDevelopment ? projectRoot : currentRoot;

  const publicPath = path.join(rootForAssets, 'public');
  const viewsPath = path.join(publicPath, 'views');
  const dataPath = path.join(projectRoot, 'data');
  const tempPath = path.join(projectRoot, 'temp');
  const videosPath = path.join(dataPath, 'media', 'videos');
  const distPath = path.join(projectRoot, 'dist');
  
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
    clientSettingsDefaultPath
  };
}
