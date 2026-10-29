import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function requireDarwinX64() {
  if (process.platform !== 'darwin' || process.arch !== 'x64')
    throw new Error(
      'Run on native Intel macOS or the macos-15-intel GitHub Actions runner. Windows/WSL cannot build or execute macOS apps.'
    );
  if (process.argv.length > 2) throw new Error('This Darwin x64 command accepts no arguments.');
  const current = process.versions.node.split('.').map(Number);
  const minimum = [24, 22, 1];
  const difference = current.findIndex((part, index) => part !== minimum[index]);
  if (difference !== -1 && current[difference] < minimum[difference])
    throw new Error('Node.js 24.22.1 or newer is required.');
  if (Number(run('sw_vers', ['-productVersion'], { stdio: 'pipe' }).split('.')[0]) < 15)
    throw new Error('The Darwin x64 baseline requires macOS 15 or newer.');
  const translated = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
  if (translated.stdout?.trim() === '1')
    throw new Error('Use a native Intel Mac, not Rosetta, for this target.');
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', encoding: 'utf8', ...options });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} failed (${result.status}): ${result.stderr ?? ''}`);
  return result.stdout;
}

export function validateMachOX64(header) {
  if (
    header.length < 32 ||
    header.readUInt32LE(0) !== 0xfeedfacf ||
    header.readUInt32LE(4) !== 0x01000007
  )
    throw new Error('Expected a thin x86_64 Mach-O binary');
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

export function inspectMachOX64(file) {
  try {
    validateMachOX64(readFileSync(file));
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

export function inspectDarwinDependencies(file) {
  inspectMachOX64(file);
  const output = run('otool', ['-L', file], { stdio: 'pipe' });
  return validateDarwinDependencies(output);
}
