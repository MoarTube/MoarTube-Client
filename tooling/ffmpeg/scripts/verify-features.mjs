import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// FFmpeg lists format aliases on a single row (e.g. mov,mp4,m4a,3gp,3g2,mj2).
export function listedNames(report, kind) {
  const names = new Set();
  let direction;
  for (const line of report.split(/\r?\n/)) {
    if (line.trim() === 'Input:') direction = 'inputProtocols';
    if (line.trim() === 'Output:') direction = 'outputProtocols';
    let name;
    if (kind.endsWith('Protocols')) {
      if (direction === kind && /^\s+[a-z0-9_]+\s*$/.test(line)) name = line.trim();
    } else if (kind === 'hwaccels' || kind === 'bsfs') {
      if (/^\s*[a-z0-9_]+\s*$/.test(line)) name = line.trim();
    } else {
      // Codec/filter/format rows have flags, then a name, then a description.
      name = line.match(/^\s*[A-Z.<>|]{1,6}\s+([a-z0-9_,\-]+)\s+/)?.[1];
    }
    if (name) for (const alias of name.split(',')) names.add(alias);
  }
  return names;
}

export function missingFeatures(requirements, reports) {
  return Object.entries(requirements).flatMap(([kind, required]) => {
    const names = listedNames(reports[kind] ?? '', kind);
    return required.filter((name) => !names.has(name)).map((name) => `${kind}: ${name}`);
  });
}

function assertX64Pe(executable) {
  const bytes = readFileSync(executable);
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d)
    throw new Error(`${executable}: expected Windows PE executable`);
  const offset = bytes.readUInt32LE(0x3c);
  if (
    offset > bytes.length - 6 ||
    bytes.readUInt32LE(offset) !== 0x4550 ||
    bytes.readUInt16LE(offset + 4) !== 0x8664
  ) {
    throw new Error(`${executable}: expected x64 PE machine type`);
  }
}

function run(executable, args) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function main() {
  const [ffmpegArg, ffprobeArg, reportArg, target = 'win32-x64'] = process.argv.slice(2);
  if (!['win32-x64', 'linux-x64', 'linux-arm64'].includes(target))
    throw new Error('Unsupported verification target');
  const specification = JSON.parse(
    readFileSync(new URL(`../features/${target}.json`, import.meta.url), 'utf8')
  );
  if (!ffmpegArg || !ffprobeArg)
    throw new Error(
      'Usage: npm run ffmpeg:verify:windows -- <ffmpeg.exe> <ffprobe.exe> [report-directory]'
    );
  if (process.platform !== (target === 'win32-x64' ? 'win32' : 'linux'))
    throw new Error('Run artifact checks on the target operating system.');
  const ffmpeg = path.resolve(ffmpegArg);
  const ffprobe = path.resolve(ffprobeArg);
  const directory = path.resolve(reportArg ?? `build/ffmpeg/reports/${target}`);
  if (target === 'win32-x64') {
    assertX64Pe(ffmpeg);
    assertX64Pe(ffprobe);
  } else {
    const { assertLinuxElf } = await import('./linux-elf.mjs');
    const arch = target.slice('linux-'.length);
    if (process.arch !== arch) throw new Error('Run Linux verification on the target architecture');
    assertLinuxElf(readFileSync(ffmpeg), arch);
    assertLinuxElf(readFileSync(ffprobe), arch);
  }
  mkdirSync(directory, { recursive: true });
  const reports = {};
  const commands = {
    version: '-version',
    buildconf: '-buildconf',
    license: '-L',
    encoders: '-encoders',
    decoders: '-decoders',
    hwaccels: '-hwaccels',
    filters: '-filters',
    demuxers: '-demuxers',
    muxers: '-muxers',
    formats: '-formats',
    bsfs: '-bsfs',
    protocols: '-protocols',
  };
  for (const [name, flag] of Object.entries(commands)) {
    reports[name] = run(ffmpeg, ['-hide_banner', flag]);
    writeFileSync(path.join(directory, `${name}.txt`), reports[name]);
  }
  reports.inputProtocols = reports.protocols;
  reports.outputProtocols = reports.protocols;
  const probeVersion = run(ffprobe, ['-version']);
  writeFileSync(path.join(directory, 'ffprobe-version.txt'), probeVersion);
  const failures = missingFeatures(specification.requirements, reports);
  for (const [program, report] of [
    ['ffmpeg', reports.version],
    ['ffprobe', probeVersion],
  ]) {
    const version = report.match(new RegExp(`^${program} version (?:n)?([^\\s]+)`))?.[1];
    if (
      version !== specification.ffmpegVersion &&
      !version?.startsWith(`${specification.ffmpegVersion}-`)
    ) {
      failures.push(
        `${program}: expected ${specification.ffmpegVersion}, found ${version ?? 'unknown'}`
      );
    }
    if (!report.includes('--enable-gpl'))
      failures.push(`${program}: expected GPL-enabled build for libx264`);
    if (report.includes('--enable-nonfree')) failures.push(`${program}: nonfree build rejected`);
  }
  // This is a compiled-feature check only. Never turn it into hardware certification.
  const result = {
    target: specification.target,
    ffmpeg,
    ffprobe,
    checkedAt: new Date().toISOString(),
    compiledFeaturesPassed: failures.length === 0,
    binarySha256: {
      ffmpeg: createHash('sha256').update(readFileSync(ffmpeg)).digest('hex'),
      ffprobe: createHash('sha256').update(readFileSync(ffprobe)).digest('hex'),
    },
    hardwareQualification: 'pending',
    failures,
  };
  writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  if (failures.length)
    throw new Error(`${target} feature verification failed:\n${failures.join('\n')}`);
  console.log(
    `${target} compiled features passed. Reports: ${directory}. Hardware qualification remains pending.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
