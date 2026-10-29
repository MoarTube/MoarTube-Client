import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopPaths } from '../tooling/build-paths.cjs';
import { requireDarwinTarget, run } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
import { verifyDarwinBundle } from './lib/darwin-package.mjs';

const { arch, target } = requireDarwinTarget();
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const layout = desktopPaths(root, target, version);
const result = verifyDarwinBundle(
  path.join(layout.packages, `${arch === 'arm64' ? 'mac-arm64' : 'mac'}/MoarTube Client.app`),
  arch
);
run('hdiutil', ['verify', path.join(layout.packages, `MoarTube-Client-${version}-${target}.dmg`)]);
mkdirSync(layout.reports, { recursive: true });
writeFileSync(
  path.join(layout.reports, 'package.json'),
  JSON.stringify({ passed: true, ...result }, null, 2) + '\n'
);
