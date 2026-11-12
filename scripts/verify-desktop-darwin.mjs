import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopPaths } from '../tooling/build-paths.cjs';
import { darwinPaths, darwinVariant, parseDarwinDesktopArgs } from '../desktop/darwin-variant.cjs';
import { sha256 } from './lib/desktop-ffmpeg.mjs';
import { requireDarwinTarget, run } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
import { verifyDarwinBundle } from './lib/darwin-package.mjs';

const { arch, target, variants } = parseDarwinDesktopArgs(process.argv.slice(2));
requireDarwinTarget([`--arch=${arch}`]);
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const sharedReports = desktopPaths(root, target, version).reports;
for (const variant of variants) {
  const selected = darwinVariant(variant);
  const layout = darwinPaths(root, arch, version, variant);
  const token = `${Date.now()}-${process.pid}`;
  const work = path.join(layout.work, 'verification', variant, token);
  const reports = path.join(layout.reports, 'verification', token);
  for (const dir of [work, reports]) mkdirSync(dir, { recursive: true });
  const prefix = `${selected.prefix}-${version}-${target}`;
  const checksums = new Map(
    readFileSync(path.join(layout.release, `SHA256SUMS-${target}-${variant}.txt`), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
        if (!match) throw new Error('Invalid Darwin release checksum entry');
        return [match[2], match[1]];
      })
  );
  if (
    checksums.size !== (selected.bundled ? 4 : 3) ||
    !checksums.has(`${prefix}.dmg`) ||
    !checksums.has(`${prefix}.zip`) ||
    ![...checksums.keys()].some((name) => name.endsWith('-sources.tar.xz')) ||
    (selected.bundled &&
      ![...checksums.keys()].some(
        (name) => name.startsWith(`${prefix}-`) && /-[a-f0-9]{12}-sources\.zip$/.test(name)
      ))
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
      const bundle = await verifyDarwinBundle(app, arch, variant);
      const resources = path.join(app, 'Contents/Resources');
      run(
        path.join(app, 'Contents/MacOS', selected.executable),
        [path.join(root, 'scripts/desktop-backend-probe.cjs'), resources],
        { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
      );
      copyFileSync(
        path.join(sharedReports, 'backend-probe.json'),
        path.join(reports, `${mode}-backend.json`)
      );
      run(
        process.execPath,
        [
          path.join(
            root,
            selected.bundled ? 'scripts/desktop-bundled-smoke.mjs' : 'scripts/desktop-smoke.mjs'
          ),
          path.join(app, 'Contents/MacOS', selected.executable),
        ],
        { cwd: root }
      );
      for (const file of ['smoke.json', 'window.png'])
        copyFileSync(
          path.join(sharedReports, selected.bundled ? 'bundled-packaged' : 'packaged', file),
          path.join(reports, `${mode}-${file}`)
        );
      if (selected.bundled)
        run(
          process.execPath,
          [
            path.join(root, 'scripts/desktop-share-smoke.mjs'),
            path.join(app, 'Contents/MacOS', selected.executable),
          ],
          { cwd: root }
        );
      results.push({ mode, passed: true, ...bundle });
    }
    await test(path.join(zip, `${selected.productName}.app`), 'zip');
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
      app = path.join(work, 'Applications espace café', `${selected.productName}.app`);
      mkdirSync(path.dirname(app), { recursive: true });
      run('ditto', [path.join(mount, `${selected.productName}.app`), app]);
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
          target,
          variant,
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
  console.log(`Darwin ${arch} ${variant} ZIP and DMG verification passed. Reports: ${reports}`);
}
