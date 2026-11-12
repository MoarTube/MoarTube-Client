import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { darwinPaths, darwinVariant, parseDarwinDesktopArgs } from '../desktop/darwin-variant.cjs';
import { requireDarwinTarget, run } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
import { verifyDarwinBundle } from './lib/darwin-package.mjs';

const { arch, target, variant, dir } = parseDarwinDesktopArgs(process.argv.slice(2), 'client');
requireDarwinTarget([`--arch=${arch}`]);
const selected = darwinVariant(variant);
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const layout = darwinPaths(root, arch, version, variant);
const result = await verifyDarwinBundle(
  path.join(
    layout.packages,
    `${arch === 'arm64' ? 'mac-arm64' : 'mac'}/${selected.productName}.app`
  ),
  arch,
  variant
);
if (!dir)
  run('hdiutil', [
    'verify',
    path.join(layout.packages, `${selected.prefix}-${version}-${target}.dmg`),
  ]);
mkdirSync(layout.reports, { recursive: true });
writeFileSync(
  path.join(layout.reports, 'package.json'),
  JSON.stringify({ passed: true, mode: dir ? 'directory' : 'distribution', ...result }, null, 2) +
    '\n'
);
