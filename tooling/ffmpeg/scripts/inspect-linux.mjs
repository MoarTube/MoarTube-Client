import { linuxTarget } from './linux-target.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLinuxElf, glibcRequirements } from './linux-elf.mjs';

if (process.platform !== 'linux') throw new Error('Inspect Linux binaries on Linux');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const { arch, target } = linuxTarget(process.env.MOARTUBE_FFMPEG_ARCH ?? process.arch);
const directory = path.join(root, 'build/ffmpeg/reports', target);
mkdirSync(directory, { recursive: true });
const allowed = new Set([
  'libva.so.2',
  'libva-drm.so.2',
  'libdrm.so.2',
  'libgnutls.so.30',
  'libm.so.6',
  'libc.so.6',
  'libstdc++.so.6',
  'libgcc_s.so.1',
]);
// AArch64 glibc can record its loader as a direct dependency (e.g. for TLS).
if (arch === 'arm64') allowed.add('ld-linux-aarch64.so.1');
const results = [];
for (const name of ['ffmpeg', 'ffprobe']) {
  const executable = path.join(root, 'build/ffmpeg/install', target, 'bin', name);
  const bytes = readFileSync(executable);
  assertLinuxElf(bytes, arch);
  const dynamic = execFileSync('readelf', ['-d', executable], { encoding: 'utf8' });
  const versions = execFileSync('readelf', ['-V', executable], { encoding: 'utf8' });
  const ldd = execFileSync('ldd', [executable], { encoding: 'utf8' });
  const imports = [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].map((match) => match[1]);
  const unexpected = imports.filter((name) => !allowed.has(name));
  const glibc = glibcRequirements(versions);
  writeFileSync(path.join(directory, `${name}-elf.txt`), dynamic + versions + ldd);
  results.push({
    name,
    imports,
    unexpected,
    glibc,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  if (/not found/.test(ldd) || !imports.length || unexpected.length)
    throw new Error(`Unexpected or missing Linux dependencies: ${name} ${unexpected}`);
}
writeFileSync(path.join(directory, 'dependencies.json'), JSON.stringify(results, null, 2) + '\n');
console.log('Linux ELF and runtime dependency checks passed; GLIBC requirements <= 2.39.');
