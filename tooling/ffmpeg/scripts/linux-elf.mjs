export function assertLinuxElf(bytes, arch) {
  const machine = { x64: 62, arm64: 183 }[arch];
  if (
    machine === undefined ||
    bytes.length < 64 ||
    bytes.toString('hex', 0, 4) !== '7f454c46' ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes.readUInt16LE(18) !== machine
  )
    throw new Error(`Expected Linux ${arch} little-endian ELF executable`);
}
export const assertX64Elf = (bytes) => assertLinuxElf(bytes, 'x64');

export function glibcRequirements(text, maximum = '2.39') {
  const versions = [
    ...new Set([...text.matchAll(/\bGLIBC_(\d+\.\d+(?:\.\d+)?)\b/g)].map((match) => match[1])),
  ];
  const newer = (value) => {
    const a = value.split('.').map(Number),
      b = maximum.split('.').map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
    }
    return false;
  };
  if (!versions.length) throw new Error('No GLIBC version requirements found');
  if (versions.some(newer))
    throw new Error(
      `GLIBC requirement exceeds Ubuntu 24.04 baseline ${maximum}: ${versions.filter(newer).join(', ')}`
    );
  return versions;
}
