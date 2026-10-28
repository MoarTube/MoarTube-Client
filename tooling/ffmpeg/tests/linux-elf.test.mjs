import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertX64Elf, glibcRequirements } from '../scripts/linux-elf.mjs';

test('rejects Windows, ARM64, truncated and big-endian files as Linux x64 artifacts', () => {
  const elf = Buffer.alloc(64);
  elf.write('7f454c46', 0, 'hex');
  elf[4] = 2;
  elf[5] = 1;
  elf.writeUInt16LE(62, 18);
  assert.doesNotThrow(() => assertX64Elf(elf));
  for (const bytes of [
    Buffer.from('MZ'),
    elf.subarray(0, 32),
    Buffer.from(elf),
    Buffer.from(elf),
  ]) {
    if (bytes.length === 64) bytes[5] = 2;
    assert.throws(() => assertX64Elf(bytes), /ELF/);
  }
  elf.writeUInt16LE(183, 18);
  assert.throws(() => assertX64Elf(elf), /ELF/);
});

test('rejects GLIBC requirements newer than Ubuntu 24.04, comparing versions numerically', () => {
  assert.deepEqual(glibcRequirements('GLIBC_2.2.5 GLIBC_2.9 GLIBC_2.39 GLIBC_2.39'), [
    '2.2.5',
    '2.9',
    '2.39',
  ]);
  for (const version of ['2.40', '2.43', '2.100', '3.0'])
    assert.throws(() => glibcRequirements(`GLIBC_${version}`), /baseline/);
  assert.throws(() => glibcRequirements('no version information'), /No GLIBC/);
});
