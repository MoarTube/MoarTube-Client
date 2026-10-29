import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function darwinTarget(arch = 'x64') {
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Darwin architecture: ${arch}`);
  return { arch, target: `darwin-${arch}` };
}

export function parseDarwinTarget(args = []) {
  if (args.length > 1 || (args.length === 1 && !/^--arch=(x64|arm64)$/.test(args[0])))
    throw new Error('Darwin commands accept only --arch=x64 or --arch=arm64 (default: x64).');
  return darwinTarget(args[0]?.slice('--arch='.length) ?? 'x64');
}

export function requireDarwinTarget(args = process.argv.slice(2)) {
  const selected = parseDarwinTarget(args);
  if (process.platform !== 'darwin' || process.arch !== selected.arch)
    throw new Error(
      `Run on matching native macOS ${selected.arch} with native Node.js. Use macos-15-intel for x64 or macos-15 for ARM64 in GitHub Actions. Windows/WSL cannot build or execute macOS apps.`
    );
  const current = process.versions.node.split('.').map(Number);
  const minimum = [24, 22, 1];
  const difference = current.findIndex((part, index) => part !== minimum[index]);
  if (difference !== -1 && current[difference] < minimum[difference])
    throw new Error('Node.js 24.22.1 or newer is required.');
  if (Number(run('sw_vers', ['-productVersion'], { stdio: 'pipe' }).split('.')[0]) < 15)
    throw new Error('The Darwin baseline requires macOS 15 or newer.');
  const translated = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
  if (translated.stdout?.trim() === '1')
    throw new Error('Use matching native hardware and Node.js, not Rosetta, for this target.');
  return selected;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', encoding: 'utf8', ...options });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} failed (${result.status}): ${result.stderr ?? ''}`);
  return result.stdout;
}

export function validateMachO(header, arch = 'x64') {
  darwinTarget(arch);
  const cpu = arch === 'arm64' ? 0x0100000c : 0x01000007;
  if (header.length < 32 || header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== cpu)
    throw new Error(`Expected a thin ${arch === 'arm64' ? 'arm64' : 'x86_64'} Mach-O binary`);
  const count = header.readUInt32LE(16);
  const end = 32 + header.readUInt32LE(20);
  if (end > header.length) throw new Error('Truncated Mach-O commands');
  let offset = 32;
  for (let index = 0; index < count; index++) {
    if (offset + 8 > end) throw new Error('Truncated Mach-O command');
    const command = header.readUInt32LE(offset);
    const size = header.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > end) throw new Error('Invalid Mach-O command size');
    if (command === 0x24 || command === 0x32) {
      const versionOffset = command === 0x24 ? 8 : 12;
      if (size < versionOffset + 4) throw new Error('Truncated deployment target');
      if (command === 0x32 && header.readUInt32LE(offset + 8) !== 1)
        throw new Error('Expected macOS platform');
      if (header.readUInt32LE(offset + versionOffset) > 0x000f0000)
        throw new Error('Mach-O requires newer than macOS 15.0');
    }
    offset += size;
  }
  if (offset !== end) throw new Error('Inconsistent Mach-O command table');
}

export function inspectMachO(file, arch = 'x64') {
  try {
    validateMachO(readFileSync(file), arch);
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

export function validateDarwinDependencies(output) {
  const dependencies = output
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' (')[0])
    .filter(Boolean);
  if (
    !dependencies.length ||
    dependencies.some(
      (name) => !name.startsWith('/usr/lib/') && !name.startsWith('/System/Library/')
    )
  )
    throw new Error(`Non-system runtime dependency: ${output}`);
  return dependencies;
}

export function inspectDarwinDependencies(file, arch = 'x64') {
  inspectMachO(file, arch);
  const output = run('otool', ['-L', file], { stdio: 'pipe' });
  return validateDarwinDependencies(output);
}
