import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegPaths } from '../../build-paths.cjs';
import { requireDarwinTarget, run } from './darwin-native.mjs';
import { verifyDarwinBinaries } from './darwin-verification.mjs';
import { recipeHash } from './recipe-hash.mjs';

const { arch, target } = requireDarwinTarget();
const os = run('sw_vers', [], { stdio: 'pipe' });
const root = fileURLToPath(new URL('../../../', import.meta.url));
const layout = ffmpegPaths(root, target);
const verificationRecipeSha256 = recipeHash(root, target);
const base = path.join(layout.reports, 'verification');
const reports = path.join(base, `${Date.now()}-${process.pid}`);
mkdirSync(reports, { recursive: true });
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
let buildId;
let verified;
let failure;
try {
  if (!existsSync(layout.selection))
    throw new Error(`Build or restore ${target} FFmpeg first; no selected candidate is available.`);
  const selection = read(layout.selection);
  buildId = selection.buildId;
  if (
    typeof buildId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(buildId) ||
    selection.runtime !== `${buildId}/runtime`
  )
    throw new Error('Invalid selected Darwin FFmpeg candidate');
  const candidate = path.join(layout.candidates, selection.runtime);
  const manifest = read(path.join(candidate, 'manifest.json'));
  if (manifest.schemaVersion !== 1 || manifest.target !== target || manifest.buildId !== buildId)
    throw new Error('Darwin FFmpeg candidate identity or architecture mismatch');
  const binaries = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    const entry = manifest.files?.[name];
    if (entry?.path !== `${buildId}/${name}` || !/^[a-f0-9]{64}$/.test(entry.sha256))
      throw new Error(`Invalid selected ${name} metadata`);
    const file = path.join(candidate, entry.path);
    if (digest(file) !== entry.sha256) throw new Error(`Selected ${name} checksum mismatch`);
    const installed = path.join(layout.install, 'bin', name);
    if (existsSync(installed) && digest(installed) !== entry.sha256)
      throw new Error(`Installed ${name} differs from the selected candidate`);
    binaries[name] = file;
  }
  verified = verifyDarwinBinaries({ ...binaries, arch, reports });
  for (const name of ['ffmpeg', 'ffprobe'])
    if (verified.files[name].sha256 !== manifest.files[name].sha256)
      throw new Error(`Verified ${name} differs from the selected candidate`);
} catch (error) {
  failure = error;
} finally {
  const result = {
    target,
    arch,
    os,
    buildId,
    verificationRecipeSha256,
    passed: !failure,
    checkedAt: new Date().toISOString(),
    binarySha256: verified
      ? Object.fromEntries(
          Object.entries(verified.files).map(([name, file]) => [name, file.sha256])
        )
      : undefined,
    videoToolboxHardware: 'pending',
    reports: path.relative(root, reports).replaceAll('\\', '/'),
    error: failure?.message,
  };
  writeFileSync(path.join(reports, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(path.join(base, 'latest.json'), JSON.stringify(result, null, 2) + '\n');
}
if (failure) throw failure;
console.log(
  `${target} FFmpeg features, architecture, signatures, dependencies and software media checks passed. Reports: ${reports}`
);
