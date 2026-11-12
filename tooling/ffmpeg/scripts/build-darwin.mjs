import { recipeHash } from './recipe-hash.mjs';
import { createHash } from 'node:crypto';
import { downloadArchive } from './download-archive.mjs';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  cpSync,
  copyFileSync,
  readdirSync,
  chmodSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegPaths } from '../../build-paths.cjs';
import { requireDarwinTarget, run } from './darwin-native.mjs';
import { verifyDarwinBinaries } from './darwin-verification.mjs';

const { arch, target } = requireDarwinTarget();
const root = fileURLToPath(new URL('../../../', import.meta.url));
const layout = ffmpegPaths(root, target);
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const json = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
for (const dir of [layout.sources, layout.work, layout.reports, layout.logs, layout.state])
  mkdirSync(dir, { recursive: true });
if (
  existsSync(path.join(layout.work, 'sources')) ||
  existsSync(path.join(layout.install, 'bin/ffmpeg'))
)
  throw new Error(
    'Darwin build output already exists. Preserve its candidate/release and use a fresh checkout for a rebuild.'
  );
const wanted = new Set(['ffmpeg', 'x264', 'libvpx', 'opus', 'dav1d', 'zlib']);
const lock = read(path.join(root, 'tooling/ffmpeg/sources.lock.json'));
lock.target = target;
lock.sources = lock.sources.filter((source) => wanted.has(source.id));
if (lock.sources.length !== wanted.size) throw new Error('Darwin source lock is incomplete');
const versions = {};
for (const [name, args] of [
  ['clang', ['--version']],
  ['cmake', ['--version']],
  ['ninja', ['--version']],
  ['meson', ['--version']],
  ['nasm', ['-v']],
  ['pkg-config', ['--version']],
  ['xcrun', ['--show-sdk-version']],
  ['sw_vers', []],
])
  versions[name] = run(name, args, { stdio: 'pipe' });
json(path.join(layout.reports, 'toolchain.json'), {
  versions,
  deploymentTarget: '15.0',
  execution: `native-macos-${arch}`,
});
json(path.join(layout.reports, 'sources.lock.json'), lock);
for (const source of lock.sources) {
  const archive = await downloadArchive(source, layout.sources);
  const destination = path.join(layout.work, 'sources', source.id);
  mkdirSync(destination, { recursive: true });
  run('tar', ['-xf', archive, '--strip-components=1', '-C', destination]);
}
run('bash', [path.join(root, 'tooling/ffmpeg/platforms/darwin/build.sh'), root, arch]);
for (const name of ['ffmpeg', 'ffprobe'])
  run('codesign', ['--force', '--sign', '-', path.join(layout.install, 'bin', name)]);
const { files } = verifyDarwinBinaries({
  ffmpeg: path.join(layout.install, 'bin/ffmpeg'),
  ffprobe: path.join(layout.install, 'bin/ffprobe'),
  arch,
  reports: layout.reports,
});
const recipeSha256 = recipeHash(root, target);
const version = lock.sources.find((source) => source.id === 'ffmpeg').version;
const buildId = `${version}-moartube-${target}-${files.ffmpeg.sha256.slice(0, 16)}-r${recipeSha256.slice(0, 8)}`;
const runtime = path.join(layout.candidates, buildId, 'runtime');
const sources = path.join(layout.candidates, buildId, 'source');
const release = path.join(layout.releases, buildId);
if (existsSync(runtime) || existsSync(sources))
  throw new Error('Immutable Darwin candidate already exists');
for (const dir of [path.join(runtime, buildId), path.join(sources, 'sources'), release])
  mkdirSync(dir, { recursive: true });
for (const name of ['ffmpeg', 'ffprobe']) {
  files[name].path = `${buildId}/${name}`;
  copyFileSync(path.join(layout.install, 'bin', name), path.join(runtime, files[name].path));
  chmodSync(path.join(runtime, files[name].path), 0o755);
}
for (const source of lock.sources) {
  copyFileSync(
    path.join(layout.sources, source.archive),
    path.join(sources, 'sources', source.archive)
  );
  const dir = path.join(layout.work, 'sources', source.id);
  const licenses = readdirSync(dir).filter((name) =>
    /^(COPYING|LICENSE|PATENTS|NOTICE)([.\-_]|$)/i.test(name)
  );
  if (!licenses.length) throw new Error(`Missing license material: ${source.id}`);
  for (const name of licenses)
    cpSync(path.join(dir, name), path.join(runtime, 'licenses', source.id, name), {
      recursive: true,
    });
}
const manifest = {
  schemaVersion: 1,
  target,
  version,
  buildId,
  baseline: { macOS: '15.0', cpu: arch === 'arm64' ? 'armv8-a' : 'x86-64' },
  qualification: {
    compiledFeatures: 'passed',
    softwareSmoke: 'passed',
    videoToolboxHardware: 'pending',
  },
  files,
};
const provenance = {
  buildId,
  target,
  recipeSha256,
  createdAt: new Date().toISOString(),
  toolchain: versions,
  qualification: manifest.qualification,
};
const notice =
  `MoarTube FFmpeg ${buildId}\nGPL-enabled FFmpeg including libx264. Static third-party codec libraries; Apple system frameworks are runtime dependencies.\nCorresponding sources: ${buildId}-sources.tar.xz. See licenses/ and SOURCES.txt.\n\n` +
  lock.sources
    .map(
      (source) =>
        `${source.id} ${source.version}: ${source.license}\n${source.url}\nSHA256 ${source.sha256}`
    )
    .join('\n\n') +
  '\n';
for (const dir of [runtime, sources]) {
  json(path.join(dir, 'manifest.json'), manifest);
  json(path.join(dir, 'provenance.json'), provenance);
  writeFileSync(path.join(dir, 'NOTICES.txt'), notice);
}
cpSync(path.join(runtime, 'licenses'), path.join(sources, 'licenses'), { recursive: true });
cpSync(path.join(root, 'tooling/ffmpeg'), path.join(sources, 'recipe/tooling/ffmpeg'), {
  recursive: true,
});
copyFileSync(
  path.join(root, 'tooling/build-paths.cjs'),
  path.join(sources, 'recipe/tooling/build-paths.cjs')
);
copyFileSync(path.join(root, 'LICENSE.md'), path.join(sources, 'recipe/LICENSE.md'));
cpSync(layout.reports, path.join(sources, 'reports'), {
  recursive: true,
  filter: (file) => !path.basename(file).startsWith('media espace'),
});
writeFileSync(
  path.join(sources, 'BUILD.txt'),
  `Requires native macOS ${arch} 15+, Xcode command line tools, matching native Node.js 24.22.1 or newer, cmake, ninja, meson, nasm, pkg-config and xz. From recipe/, run node tooling/ffmpeg/scripts/build-darwin.mjs --arch=${arch}. To reuse sources, copy sources/* into recipe/build/ffmpeg/cache/sources/. See reports/toolchain.json for recorded compiler and SDK versions; build tools are not vendored.\n`
);
const archives = [];
for (const [suffix, directory] of [
  ['runtime', runtime],
  ['sources', sources],
]) {
  const name = `${buildId}-${suffix}.tar.xz`;
  run('tar', ['-cJf', path.join(release, name), '-C', directory, '.']);
  run('xz', ['--test', path.join(release, name)]);
  // BSD tar has no --compare; extract independently and compare file bytes.
  const extracted = path.join(layout.work, `archive-check-${suffix}`);
  mkdirSync(extracted, { recursive: true });
  run('tar', ['-xJf', path.join(release, name), '-C', extracted]);
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const source = path.join(entry.parentPath ?? entry.path, entry.name);
    if (hash(source) !== hash(path.join(extracted, path.relative(directory, source))))
      throw new Error(`Archive mismatch: ${name}`);
  }
  archives.push(name);
}
writeFileSync(
  path.join(release, 'SHA256SUMS.txt'),
  archives.map((name) => `${hash(path.join(release, name))}  ${name}`).join('\n') + '\n'
);
json(layout.selection, {
  buildId,
  runtime: `${buildId}/runtime`,
  runtimeArchive: archives[0],
  sourceArchive: archives[1],
});
console.log(`Verified ${target} FFmpeg candidate: ${buildId}`);
