import { recipeHash } from './recipe-hash.mjs';
import { linuxTarget } from './linux-target.mjs';
import { ffmpegPaths } from '../../build-paths.cjs';
import { createHash } from 'node:crypto';
import {
  cpSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux')
  throw new Error('Package Linux artifacts inside the Linux build container');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const { arch, target, cpu } = linuxTarget(process.env.MOARTUBE_FFMPEG_ARCH ?? process.arch);
const layout = ffmpegPaths(root, target);
const build = layout.base;
const report = path.join(build, 'reports', target);
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const read = (name) => JSON.parse(readFileSync(path.join(report, name), 'utf8'));
const features = read('result.json'),
  software = read('software/result.json'),
  dependencies = read('dependencies.json');
const binaryHashes = Object.fromEntries(
  ['ffmpeg', 'ffprobe'].map((name) => [
    name,
    digest(path.join(build, 'install', target, 'bin', name)),
  ])
);
if (
  !features.compiledFeaturesPassed ||
  !software.results.length ||
  software.results.some((entry) => !entry.passed) ||
  dependencies.length !== 2
)
  throw new Error('Linux verification evidence is incomplete or failed');
for (const name of ['ffmpeg', 'ffprobe'])
  if (
    features.binarySha256[name] !== binaryHashes[name] ||
    software.binarySha256[name] !== binaryHashes[name] ||
    dependencies.find((entry) => entry.name === name)?.sha256 !== binaryHashes[name]
  )
    throw new Error('Linux verification evidence does not match binaries');
const tooling = path.join(root, 'tooling/ffmpeg');
const recipeSha256 = recipeHash(root, target);
const buildId = `9.0.2-moartube-${target}-${binaryHashes.ffmpeg.slice(0, 16)}-r${recipeSha256.slice(0, 8)}`;
const artifacts = path.join(layout.releases, buildId);
const runtime = path.join(layout.candidates, buildId, 'runtime');
const sources = path.join(layout.candidates, buildId, 'source');
mkdirSync(artifacts, { recursive: true });
mkdirSync(layout.state, { recursive: true });
if (existsSync(runtime))
  throw new Error('Linux candidate already exists; use a fresh container output directory.');
mkdirSync(path.join(runtime, buildId), { recursive: true });
mkdirSync(path.join(sources, 'sources'), { recursive: true });
const manifest = {
  schemaVersion: 1,
  target,
  version: '9.0.2',
  buildId,
  baseline: {
    distribution: 'Ubuntu 24.04',
    glibcMaximum: '2.39',
    cpu,
    runtimePackages: ['libva2', 'libva-drm2', 'libdrm2', 'libgnutls30t64', 'ca-certificates'],
  },
  qualification: {
    compiledFeatures: 'passed',
    softwareSmoke: 'passed',
    ubuntu2404: 'pending',
    ubuntu2604: 'pending',
    nvidia: 'pending',
    amd: 'pending',
    intel: 'pending',
  },
  files: {},
};
for (const name of ['ffmpeg', 'ffprobe']) {
  copyFileSync(path.join(build, 'install', target, 'bin', name), path.join(runtime, buildId, name));
  manifest.files[name] = { path: `${buildId}/${name}`, sha256: binaryHashes[name] };
}
const lock = read('sources.lock.json');
for (const source of lock.sources) {
  const archive = path.join(build, 'cache/sources', source.archive);
  if (digest(archive) !== source.sha256) throw new Error('Linux source checksum mismatch');
  copyFileSync(archive, path.join(sources, 'sources', source.archive));
  const directory = path.join(build, 'work', target, 'sources', source.id);
  const licenses = readdirSync(directory).filter((name) =>
    /^(COPYING|LICENSE|PATENTS|NOTICE)([.\-_]|$)/i.test(name)
  );
  if (source.id === 'nv-codec-headers') licenses.push('include/ffnvcodec');
  if (!licenses.length) throw new Error(`Missing Linux license material: ${source.id}`);
  for (const name of licenses)
    cpSync(path.join(directory, name), path.join(runtime, 'licenses', source.id, name), {
      recursive: true,
    });
}
const notice =
  `MoarTube FFmpeg ${buildId}\nGPL-enabled FFmpeg including libx264.\n` +
  `Corresponding sources: ${buildId}-sources.tar.xz, distributed alongside ${buildId}-runtime.tar.xz.\n` +
  'See licenses/ for license texts. Linux GPU drivers are host prerequisites.\n' +
  'Distro-provided VA-API, DRM, GnuTLS and libc are runtime dependencies, not bundled libraries.\n\n' +
  lock.sources
    .map(
      (source) =>
        `${source.id} ${source.version}: ${source.license}\n${source.url}\nSHA256 ${source.sha256}`
    )
    .join('\n\n') +
  '\n';
writeFileSync(path.join(runtime, 'NOTICES.txt'), notice);
writeFileSync(path.join(runtime, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  path.join(runtime, 'RUNTIME.txt'),
  `Ubuntu 24.04/26.04 ${arch} qualification targets; native GPU qualification pending.\nInstall runtime packages: sudo apt install libva2 libva-drm2 libdrm2 libgnutls30t64 ca-certificates\nThe runtime archive root can be staged as resources/ffmpeg/${target}. Keep the entire directory, including licenses and manifest.\n`
);
cpSync(path.join(runtime, 'licenses'), path.join(sources, 'licenses'), { recursive: true });
cpSync(tooling, path.join(sources, 'recipe/tooling/ffmpeg'), { recursive: true });
copyFileSync(path.join(root, 'LICENSE.md'), path.join(sources, 'recipe/LICENSE.md'));
copyFileSync(
  path.join(root, 'tooling/build-paths.cjs'),
  path.join(sources, 'recipe/tooling/build-paths.cjs')
);
cpSync(report, path.join(sources, 'reports'), {
  recursive: true,
  filter: (name) => !path.basename(name).startsWith('media espace'),
});
writeFileSync(
  path.join(sources, 'BUILD.txt'),
  `Requires Docker with Linux containers. From recipe/, run node tooling/ffmpeg/scripts/build-linux.mjs --arch=${arch}. To reuse included archives, copy sources/* into recipe/build/ffmpeg/cache/sources/. The pinned Ubuntu compiler image/toolchain must be cached or downloaded. No GPU driver is installed by the build.\n`
);
writeFileSync(path.join(sources, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(path.join(sources, 'NOTICES.txt'), notice);
const provenance = {
  target,
  architecture: arch,
  execution: process.env.MOARTUBE_BUILD_EXECUTION ?? 'container',
  engineArchitecture: process.env.MOARTUBE_BUILD_ENGINE_ARCH ?? 'unknown',
  buildId,
  recipeSha256,
  binaryHashes,
  createdAt: new Date().toISOString(),
  buildOs: readFileSync('/etc/os-release', 'utf8'),
  qualification: manifest.qualification,
};
for (const directory of [runtime, sources])
  writeFileSync(
    path.join(directory, 'provenance.json'),
    JSON.stringify(provenance, null, 2) + '\n'
  );
const names = [];
for (const [suffix, directory] of [
  ['runtime', runtime],
  ['sources', sources],
]) {
  const name = `${buildId}-${suffix}.tar.xz`;
  execFileSync('tar', ['-cJf', path.join(artifacts, name), '-C', directory, '.'], {
    stdio: 'inherit',
  });
  // A successful compressor exit alone does not establish a usable archive.
  // Check the compressed stream and compare every archived file with its input.
  execFileSync('xz', ['--test', path.join(artifacts, name)], { stdio: 'inherit' });
  execFileSync('tar', ['--compare', '-Jf', path.join(artifacts, name), '-C', directory], {
    stdio: 'inherit',
  });
  names.push(name);
}
writeFileSync(
  path.join(artifacts, 'SHA256SUMS.txt'),
  names.map((name) => `${digest(path.join(artifacts, name))}  ${name}`).join('\n') + '\n'
);
writeFileSync(
  layout.selection,
  JSON.stringify(
    { buildId, runtime: `${buildId}/runtime`, sourceArchive: names[1], runtimeArchive: names[0] },
    null,
    2
  ) + '\n'
);
console.log(`Packaged Linux runtime and separate sources: ${buildId}`);
