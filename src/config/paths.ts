import fs from 'node:fs';
import os from 'node:os';
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

// A package installed via npm (global or as a dependency) always lives inside a
// node_modules folder; a git checkout run directly does not.
function isInstalledPackage(rootPath: string): boolean {
  return rootPath.split(path.sep).includes('node_modules');
}

// OS-standard per-user data directory, matching the legacy client's location so
// upgrades from the pre-rewrite client keep using the same data.
function discoverOsDataDirectory(): string {
  const base =
    process.env['APPDATA'] ??
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Preferences')
      : path.join(os.homedir(), '.local', 'share'));

  return path.join(base, 'moartube-client');
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

  // When installed via npm (global or as a dependency), user data must not live inside
  // node_modules: it would be lost on reinstall/upgrade and may require elevated
  // permissions to write. Use the OS-standard per-user data directory instead. When run
  // from a git checkout, keep data alongside the source, as before.
  const installedAsPackage = isInstalledPackage(projectRoot);
  const dataRoot = installedAsPackage ? discoverOsDataDirectory() : projectRoot;
  const dataPath = installedAsPackage ? dataRoot : path.join(dataRoot, 'data');
  const tempPath = path.join(dataRoot, 'temp');
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
