import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopPaths } from '../tooling/build-paths.cjs';
import { sha256 } from './lib/desktop-ffmpeg.mjs';
import { requireDarwinTarget, run } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
import { verifyDarwinBundle } from './lib/darwin-package.mjs';

const { arch, target } = requireDarwinTarget();
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const layout = desktopPaths(root, target, version);
const token = `${Date.now()}-${process.pid}`;
const work = path.join(layout.work, 'verification', token);
const reports = path.join(layout.reports, 'verification', token);
for (const dir of [work, reports]) mkdirSync(dir, { recursive: true });
const prefix = `MoarTube-Client-${version}-${target}`;
const checksums = new Map(
  readFileSync(path.join(layout.release, `SHA256SUMS-${target}.txt`), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
      if (!match) throw new Error('Invalid Darwin release checksum entry');
      return [match[2], match[1]];
    })
);
if (
  checksums.size !== 3 ||
  !checksums.has(`${prefix}.dmg`) ||
  !checksums.has(`${prefix}.zip`) ||
  ![...checksums.keys()].some((name) => name.endsWith('-sources.tar.xz'))
)
  throw new Error('Darwin release assets incomplete');
for (const [name, expected] of checksums)
  if (sha256(path.join(layout.release, name)) !== expected)
    throw new Error(`Release checksum mismatch: ${name}`);
const results = [];
let failure;
try {
  const zip = path.join(work, 'ZIP espace café');
  mkdirSync(zip, { recursive: true });
  run('ditto', ['-x', '-k', path.join(layout.release, `${prefix}.zip`), zip]);
  async function test(app, mode) {
    const bundle = verifyDarwinBundle(app, arch);
    const resources = path.join(app, 'Contents/Resources');
    run(
      path.join(resources, 'runtime/node'),
      [path.join(root, 'scripts/desktop-backend-probe.cjs'), resources],
      { cwd: root }
    );
    copyFileSync(
      path.join(layout.reports, 'backend-probe.json'),
      path.join(reports, `${mode}-backend.json`)
    );
    run(
      process.execPath,
      [
        path.join(root, 'scripts/desktop-smoke.mjs'),
        path.join(app, 'Contents/MacOS/MoarTube Client'),
      ],
      { cwd: root }
    );
    for (const file of ['smoke.json', 'window.png'])
      copyFileSync(
        path.join(layout.reports, 'packaged', file),
        path.join(reports, `${mode}-${file}`)
      );
    results.push({ mode, passed: true, ...bundle });
  }
  await test(path.join(zip, 'MoarTube Client.app'), 'zip');
  const mount = path.join(work, 'mounted-dmg');
  mkdirSync(mount, { recursive: true });
  run('hdiutil', ['verify', path.join(layout.release, `${prefix}.dmg`)]);
  run('hdiutil', [
    'attach',
    '-readonly',
    '-nobrowse',
    '-mountpoint',
    mount,
    path.join(layout.release, `${prefix}.dmg`),
  ]);
  let app;
  try {
    app = path.join(work, 'Applications espace café/MoarTube Client.app');
    mkdirSync(path.dirname(app), { recursive: true });
    run('ditto', [path.join(mount, 'MoarTube Client.app'), app]);
  } finally {
    run('hdiutil', ['detach', mount]);
  }
  await test(app, 'dmg');
} catch (error) {
  failure = error;
} finally {
  writeFileSync(
    path.join(reports, 'result.json'),
    JSON.stringify(
      {
        passed: !failure && results.length === 2,
        checkedAt: new Date().toISOString(),
        os: run('sw_vers', [], { stdio: 'pipe' }),
        results,
        error: failure?.message,
        qualification: {
          downloadedGatekeeperApproval: 'pending',
          physicalMac: 'pending',
          videoToolboxHardware: 'pending',
        },
      },
      null,
      2
    ) + '\n'
  );
}
if (failure) throw failure;
console.log(`Darwin x64 ZIP and DMG verification passed. Reports: ${reports}`);
