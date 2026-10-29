import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { downloadArtifact } = require('@electron/get');
const pkg = require('../package.json');
const { defaultElectronGetCacheRoot } = require('app-builder-lib/out/util/electronGet.js');
const cacheRoot = process.env.ELECTRON_CACHE || defaultElectronGetCacheRoot();
mkdirSync(cacheRoot, { recursive: true });
const checksums = await downloadArtifact({
  version: pkg.devDependencies.electron,
  artifactName: 'SHASUMS256.txt',
  isGeneric: true,
  cacheRoot,
});
copyFileSync(checksums, path.join(cacheRoot, `SHASUMS256.txt-${pkg.devDependencies.electron}`));
await downloadArtifact({
  version: pkg.devDependencies.electron,
  artifactName: 'electron',
  platform: process.platform,
  arch: process.arch,
  cacheRoot,
});
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
await getPath7za();
if (process.platform === 'win32') {
  const tools = require('app-builder-lib/out/toolsets/windows.js');
  await tools.getRceditBundle();
  await tools.getMakeNsisPath();
  await tools.getNsisPluginsPath();
  await tools.getNsisElevatePath();
} else if (process.platform === 'linux') {
  const { getFpmPath } = require('app-builder-lib/out/toolsets/linux.js');
  await getFpmPath();
}
console.log(
  `Electron and ${process.platform}/${process.arch} packaging tools are downloaded before compilation.`
);
