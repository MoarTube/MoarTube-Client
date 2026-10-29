import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopPaths } from '../tooling/build-paths.cjs';
import { requireDarwinX64, run } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
import { verifyDarwinBundle } from './lib/darwin-package.mjs';

requireDarwinX64();
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const layout = desktopPaths(root, 'darwin-x64', version);
const result = verifyDarwinBundle(path.join(layout.packages, 'mac/MoarTube Client.app'));
run('hdiutil', ['verify', path.join(layout.packages, `MoarTube-Client-${version}-darwin-x64.dmg`)]);
mkdirSync(layout.reports, { recursive: true });
writeFileSync(
  path.join(layout.reports, 'package.json'),
  JSON.stringify({ passed: true, ...result }, null, 2) + '\n'
);
