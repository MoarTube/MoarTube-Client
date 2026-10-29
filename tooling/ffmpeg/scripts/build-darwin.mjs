import { createHash } from 'node:crypto';
import {
  createWriteStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  cpSync,
  copyFileSync,
  readdirSync,
  chmodSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegPaths } from '../../build-paths.cjs';
import { requireDarwinX64, run, inspectDarwinDependencies } from './darwin-native.mjs';

requireDarwinX64();
const root = fileURLToPath(new URL('../../../', import.meta.url));
const target = 'darwin-x64';
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
  execution: 'native-macos-x64',
});
json(path.join(layout.reports, 'sources.lock.json'), lock);
for (const source of lock.sources) {
  const archive = path.join(layout.sources, source.archive);
  if (!existsSync(archive)) {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw new Error(`Source download failed: ${source.url}`);
    const temporary = `${archive}.darwin-partial`;
    await pipeline(response.body, createWriteStream(temporary));
    if (hash(temporary) !== source.sha256)
      throw new Error(`Downloaded source checksum mismatch: ${source.id}`);
    renameSync(temporary, archive);
  }
  if (hash(archive) !== source.sha256)
    throw new Error(`Cached source checksum mismatch: ${source.id}`);
  const destination = path.join(layout.work, 'sources', source.id);
  mkdirSync(destination, { recursive: true });
  run('tar', ['-xf', archive, '--strip-components=1', '-C', destination]);
}
run('bash', [path.join(root, 'tooling/ffmpeg/platforms/darwin/build.sh'), root]);
const files = {};
const dependencies = [];
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = path.join(layout.install, 'bin', name);
  run('codesign', ['--force', '--sign', '-', file]);
  const linked = inspectDarwinDependencies(file);
  files[name] = { sha256: hash(file) };
  dependencies.push({ name, sha256: files[name].sha256, libraries: linked });
}
const ffmpeg = path.join(layout.install, 'bin/ffmpeg');
const listing = (flag) => run(ffmpeg, ['-hide_banner', flag], { stdio: 'pipe' });
const capabilities = Object.fromEntries(
  ['encoders', 'decoders', 'filters', 'protocols', 'muxers', 'demuxers', 'hwaccels'].map((name) => [
    name,
    listing(`-${name}`),
  ])
);
const required = {
  encoders: ['libx264', 'libvpx-vp9', 'libopus', 'aac', 'png', 'h264_videotoolbox'],
  decoders: ['h264', 'hevc', 'libdav1d', 'vp9', 'aac', 'opus'],
  filters: [
    'scale',
    'scale_vt',
    'hwupload',
    'hwdownload',
    'split',
    'fps',
    'overlay',
    'pad',
    'crop',
    'format',
    'aresample',
  ],
  protocols: ['file', 'pipe', 'http', 'https', 'tls', 'tcp', 'udp', 'rtmp', 'rtmps'],
  muxers: ['hls', 'mp4', 'mpegts', 'flv', 'webm', 'image2'],
  demuxers: ['mov', 'matroska', 'mpegts', 'flv', 'hls'],
  hwaccels: ['videotoolbox'],
};
for (const [kind, names] of Object.entries(required))
  for (const name of names)
    if (!new RegExp(`(^|\\s)${name}(?=\\s|,|$)`, 'm').test(capabilities[kind]))
      throw new Error(`Missing Darwin FFmpeg ${kind}: ${name}`);
json(path.join(layout.reports, 'features.json'), {
  passed: true,
  required,
  capabilities,
  binarySha256: Object.fromEntries(
    Object.entries(files).map(([name, file]) => [name, file.sha256])
  ),
});
json(path.join(layout.reports, 'dependencies.json'), dependencies);
run(process.execPath, [
  path.join(root, 'tooling/ffmpeg/scripts/verify-software.mjs'),
  ffmpeg,
  path.join(layout.install, 'bin/ffprobe'),
  path.join(layout.reports, 'software'),
]);
const software = read(path.join(layout.reports, 'software/result.json'));
if (
  !software.results.length ||
  software.results.some((result) => !result.passed) ||
  Object.entries(files).some(([name, file]) => software.binarySha256[name] !== file.sha256)
)
  throw new Error('Darwin software qualification failed or mismatches the binaries');
const recipeDigest = createHash('sha256');
function hashTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) hashTree(file);
    else
      recipeDigest
        .update(path.relative(root, file).replaceAll('\\', '/'))
        .update('\0')
        .update(readFileSync(file))
        .update('\0');
  }
}
hashTree(path.join(root, 'tooling/ffmpeg'));
recipeDigest.update(readFileSync(path.join(root, 'tooling/build-paths.cjs')));
const recipeSha256 = recipeDigest.digest('hex');
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
  baseline: { macOS: '15.0', cpu: 'x86-64' },
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
  'Requires Intel macOS 15+, Xcode command line tools, Node.js 22+, cmake, ninja, meson, nasm, pkg-config and xz. From recipe/, run node tooling/ffmpeg/scripts/build-darwin.mjs. To reuse sources, copy sources/* into recipe/build/ffmpeg/cache/sources/. See reports/toolchain.json for recorded compiler and SDK versions; build tools are not vendored.\n'
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
console.log(`Verified Darwin x64 FFmpeg candidate: ${buildId}`);
