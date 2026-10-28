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
const build = path.join(root, 'build/ffmpeg');
const report = path.join(build, 'reports/linux-x64');
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const read = (name) => JSON.parse(readFileSync(path.join(report, name), 'utf8'));
const features = read('result.json'),
  software = read('software/result.json'),
  dependencies = read('dependencies.json');
const binaryHashes = Object.fromEntries(
  ['ffmpeg', 'ffprobe'].map((name) => [
    name,
    digest(path.join(build, 'install/linux-x64/bin', name)),
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
const recipeHash = createHash('sha256');
function hashTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) hashTree(file);
    else
      recipeHash
        .update(path.relative(tooling, file))
        .update('\0')
        .update(readFileSync(file))
        .update('\0');
  }
}
hashTree(tooling);
const recipeSha256 = recipeHash.digest('hex');
const buildId = `9.0.2-moartube-linux-x64-${binaryHashes.ffmpeg.slice(0, 16)}-r${recipeSha256.slice(0, 8)}`;
const artifacts = path.join(build, 'artifacts/linux-x64');
const runtime = path.join(artifacts, buildId, 'runtime');
const sources = path.join(artifacts, buildId, 'source');
if (existsSync(runtime))
  throw new Error('Linux candidate already exists; use a fresh container output directory.');
mkdirSync(path.join(runtime, buildId), { recursive: true });
mkdirSync(path.join(sources, 'sources'), { recursive: true });
const manifest = {
  schemaVersion: 1,
  target: 'linux-x64',
  version: '9.0.2',
  buildId,
  baseline: {
    distribution: 'Ubuntu 24.04',
    glibcMaximum: '2.39',
    cpu: 'x86-64',
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
  copyFileSync(path.join(build, 'install/linux-x64/bin', name), path.join(runtime, buildId, name));
  manifest.files[name] = { path: `${buildId}/${name}`, sha256: binaryHashes[name] };
}
const lock = read('sources.lock.json');
for (const source of lock.sources) {
  const archive = path.join(build, 'cache', source.archive);
  if (digest(archive) !== source.sha256) throw new Error('Linux source checksum mismatch');
  copyFileSync(archive, path.join(sources, 'sources', source.archive));
  const directory = path.join(build, 'work/linux-x64/sources', source.id);
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
  'Ubuntu 24.04/26.04 x64 qualification targets; native GPU qualification pending.\nInstall runtime packages: sudo apt install libva2 libva-drm2 libdrm2 libgnutls30t64 ca-certificates\nThe runtime archive root can be staged as resources/ffmpeg/linux-x64. Keep the entire directory, including licenses and manifest.\n'
);
cpSync(path.join(runtime, 'licenses'), path.join(sources, 'licenses'), { recursive: true });
cpSync(tooling, path.join(sources, 'recipe/tooling/ffmpeg'), { recursive: true });
copyFileSync(path.join(root, 'LICENSE.md'), path.join(sources, 'recipe/LICENSE.md'));
cpSync(report, path.join(sources, 'reports'), {
  recursive: true,
  filter: (name) => !path.basename(name).startsWith('media espace'),
});
writeFileSync(
  path.join(sources, 'BUILD.txt'),
  'Requires Docker with Linux containers. From recipe/, run node tooling/ffmpeg/scripts/build-linux.mjs. To reuse included archives, copy sources/* into recipe/build/ffmpeg/cache/. The pinned Ubuntu compiler image/toolchain must be cached or downloaded. No GPU driver is installed by the build.\n'
);
writeFileSync(path.join(sources, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(path.join(sources, 'NOTICES.txt'), notice);
const provenance = {
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
  names.push(name);
}
writeFileSync(
  path.join(artifacts, 'SHA256SUMS.txt'),
  names.map((name) => `${digest(path.join(artifacts, name))}  ${name}`).join('\n') + '\n'
);
writeFileSync(
  path.join(artifacts, 'selected.json'),
  JSON.stringify(
    { buildId, runtime: `${buildId}/runtime`, sourceArchive: names[1], runtimeArchive: names[0] },
    null,
    2
  ) + '\n'
);
console.log(`Packaged Linux runtime and separate sources: ${buildId}`);
