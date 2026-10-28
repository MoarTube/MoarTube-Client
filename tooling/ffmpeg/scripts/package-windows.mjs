import { ffmpegPaths } from '../../build-paths.cjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  copyFileSync,
  cpSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const build = path.join(root, 'build/ffmpeg');
const layout = ffmpegPaths(root, 'win32-x64');
const bin = path.join(layout.install, 'bin');
const tooling = path.join(root, 'tooling/ffmpeg');
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = (script, args) =>
  execFileSync(process.execPath, [path.join(tooling, 'scripts', script), ...args], {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
  });
const binaries = ['ffmpeg', 'ffprobe'].map((name) => path.join(bin, `${name}.exe`));
const reports = path.join(build, 'reports/win32-x64');
const readReport = (name) => JSON.parse(readFileSync(path.join(reports, name), 'utf8'));
let features = readReport('result.json');
let software = readReport('software/result.json');
let dependencies = readReport('dependencies.json');
// Reuse passing checks only when they identify these exact executable bytes.
const hashes = { ffmpeg: digest(binaries[0]), ffprobe: digest(binaries[1]) };
if (JSON.stringify(features.binarySha256) !== JSON.stringify(hashes)) {
  run('verify-features.mjs', binaries);
  features = readReport('result.json');
}
if (JSON.stringify(software.binarySha256) !== JSON.stringify(hashes)) {
  run('verify-software.mjs', binaries);
  software = readReport('software/result.json');
}
if (dependencies.some((entry) => entry.sha256 !== hashes[entry.name])) {
  run('inspect-windows.mjs', []);
  dependencies = readReport('dependencies.json');
}
if (
  !features.compiledFeaturesPassed ||
  !software.results.length ||
  software.results.some((entry) => !entry.passed) ||
  dependencies.length !== 2 ||
  dependencies.some((entry) => entry.unexpected.length)
)
  throw new Error('Candidate has failing verification evidence');
const sources = JSON.parse(readFileSync(path.join(tooling, 'sources.lock.json'), 'utf8'));
const commandFiles = [
  'src/utils/gpu-encoding.ts',
  'src/utils/ffmpeg-path.ts',
  'src/utils/ffmpeg-artifact.ts',
  'src/services/ffmpeg.ts',
  'src/services/video-publish.ts',
  'src/services/live-stream.ts',
  'src/utils/hardware.ts',
  'src/utils/windows-gpus.ts',
  'tests/gpu-hardware.test.ts',
  'tests/windows-live-hardware.test.ts',
];
const documentation = [
  'ffmpeg-distribution-plan.md',
  'gpu-acceleration.md',
  'windows-ffmpeg-validation.md',
];
const recipeFiles = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(name);
    else recipeFiles.push(name);
  }
}
collect(tooling);
recipeFiles.push(path.join(root, 'tooling/build-paths.cjs'));
recipeFiles.push(
  ...commandFiles.map((name) => path.join(root, name)),
  ...documentation.map((name) => path.join(root, 'docs', name))
);
const recipeHash = createHash('sha256');
for (const name of recipeFiles.sort())
  recipeHash
    .update(path.relative(root, name).replaceAll('\\', '/') + '\0')
    .update(readFileSync(name))
    .update('\0');
const recipeSha256 = recipeHash.digest('hex');
const buildId = `9.0.2-moartube-${digest(binaries[0]).slice(0, 16)}-r${recipeSha256.slice(0, 8)}`;
const finalOutput = path.join(layout.candidates, buildId);
const release = path.join(layout.releases, buildId);
mkdirSync(layout.state, { recursive: true });
mkdirSync(release, { recursive: true });
mkdirSync(layout.candidates, { recursive: true });
function recordSelection(directory) {
  writeFileSync(layout.selection, JSON.stringify({ directory, buildId }, null, 2) + '\n');
}
if (existsSync(finalOutput)) {
  if (!process.argv.includes('--reuse'))
    throw new Error(`Artifact is immutable and already exists: ${finalOutput}`);
  const existing = JSON.parse(readFileSync(path.join(finalOutput, 'manifest.json'), 'utf8'));
  for (const name of ['ffmpeg', 'ffprobe']) {
    if (
      existing.files?.[name]?.sha256 !== hashes[name] ||
      digest(path.join(finalOutput, existing.files[name].path)) !== hashes[name]
    )
      throw new Error('Existing artifact checksum mismatch');
  }
  recordSelection(finalOutput);
  console.log(`Reusing verified candidate: ${finalOutput}`);
  process.exit(0);
}
const output = `${finalOutput}.partial-${process.pid}`;
mkdirSync(path.join(output, buildId), { recursive: true });
const manifest = {
  schemaVersion: 1,
  target: 'win32-x64',
  version: '9.0.2',
  buildId,
  qualification: {
    compiledFeatures: 'passed',
    softwareSmoke: 'passed',
    cleanHost: 'pending',
    nvidia: 'pending',
    amd: 'pending',
    intel: 'pending',
  },
  files: {},
};
for (const [index, name] of ['ffmpeg', 'ffprobe'].entries()) {
  copyFileSync(binaries[index], path.join(output, buildId, `${name}.exe`));
  manifest.files[name] = { path: `${buildId}/${name}.exe`, sha256: digest(binaries[index]) };
}
mkdirSync(path.join(output, 'sources'), { recursive: true });
mkdirSync(path.join(output, 'licenses'), { recursive: true });
for (const source of sources.sources) {
  const archive = path.join(layout.sources, source.archive);
  if (digest(archive) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.id}`);
  copyFileSync(archive, path.join(output, 'sources', source.archive));
  const directory = path.join(build, 'work/win32-x64/sources', source.id);
  const notices = readdirSync(directory).filter((name) =>
    /^(COPYING|LICENSE|PATENTS|NOTICE)([.\-_]|$)/i.test(name)
  );
  if (source.id === 'nv-codec-headers') notices.push('include/ffnvcodec');
  if (notices.length === 0) throw new Error(`License material missing for ${source.id}`);
  for (const notice of notices)
    cpSync(path.join(directory, notice), path.join(output, 'licenses', source.id, notice), {
      recursive: true,
    });
}
cpSync(
  path.join(build, 'toolchains/win32-x64/msys64/clang64/share/licenses'),
  path.join(output, 'licenses/toolchain-runtime'),
  { recursive: true }
);
cpSync(tooling, path.join(output, 'recipe/tooling/ffmpeg'), { recursive: true });
copyFileSync(
  path.join(root, 'tooling/build-paths.cjs'),
  path.join(output, 'recipe/tooling/build-paths.cjs')
);
for (const name of documentation) {
  mkdirSync(path.join(output, 'recipe/docs'), { recursive: true });
  copyFileSync(path.join(root, 'docs', name), path.join(output, 'recipe/docs', name));
}
for (const name of commandFiles) {
  mkdirSync(path.dirname(path.join(output, 'client-command-snapshot', name)), { recursive: true });
  copyFileSync(path.join(root, name), path.join(output, 'client-command-snapshot', name));
}
copyFileSync(
  path.join(root, 'LICENSE.md'),
  path.join(output, 'client-command-snapshot/LICENSE.md')
);
writeFileSync(
  path.join(output, 'client-command-snapshot/README.txt'),
  'These MIT-licensed client source excerpts record the commands and tests audited for this candidate. They are not a standalone client checkout. The complete FFmpeg rebuild recipe is in ../recipe/.\n'
);
const clientPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
writeFileSync(
  path.join(output, 'recipe/package.json'),
  JSON.stringify(
    {
      private: true,
      type: 'module',
      scripts: Object.fromEntries(
        Object.entries(clientPackage.scripts).filter(([name]) => name.startsWith('ffmpeg:'))
      ),
    },
    null,
    2
  ) + '\n'
);
writeFileSync(
  path.join(output, 'BUILD.txt'),
  'Requires native Windows x64 Node.js 22+. From recipe/, run npm.cmd run ffmpeg:build:windows. To reuse the included sources offline, first copy sources/* from this archive into recipe/build/ffmpeg/cache/sources/. The checksum-locked portable toolchain must also be cached or downloaded. See recipe/tooling/ffmpeg/README.md.\n'
);
cpSync(path.join(build, 'reports/win32-x64'), path.join(output, 'reports'), {
  recursive: true,
  // Preserve test evidence without duplicating large smoke-test media/binaries.
  filter: (name) => !name.includes('media espace café 日本語'),
});
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  path.join(output, 'NOTICES.txt'),
  `MoarTube Windows FFmpeg candidate ${buildId}\nGPL-enabled FFmpeg including libx264. See licenses/, sources/ and recipe/.\nGPU drivers are host prerequisites. No release certification is implied.\n\n${sources.sources.map((source) => `${source.id} ${source.version}: ${source.license}\n${source.url}\nSHA256 ${source.sha256}`).join('\n\n')}\n`
);
writeFileSync(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      buildId,
      createdAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      sourcesLockSha256: digest(path.join(tooling, 'sources.lock.json')),
      toolchainLockSha256: digest(path.join(tooling, 'toolchain.lock.json')),
      recipeSha256,
      clientCommandSha256: Object.fromEntries(
        commandFiles.map((name) => [name, digest(path.join(root, name))])
      ),
      manifestSha256: digest(path.join(output, 'manifest.json')),
      qualification: manifest.qualification,
    },
    null,
    2
  ) + '\n'
);
execFileSync('tar.exe', ['-a', '-cf', `${output}.zip`, '-C', output, '.'], {
  windowsHide: true,
  stdio: 'inherit',
});
writeFileSync(`${output}.zip.sha256`, `${digest(`${output}.zip`)}  ${buildId}.zip\n`);
renameSync(output, finalOutput);
renameSync(`${output}.zip`, path.join(release, `${buildId}.zip`));
renameSync(`${output}.zip.sha256`, path.join(release, `${buildId}.zip.sha256`));
recordSelection(finalOutput);
console.log(
  `Packaged candidate: ${path.join(release, `${buildId}.zip`)}. Hardware and clean-host qualification remain pending.`
);
