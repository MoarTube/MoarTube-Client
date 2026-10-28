const targets = {
  x64: {
    arch: 'x64',
    target: 'linux-x64',
    dockerPlatform: 'linux/amd64',
    elfMachine: 62,
    cpu: 'x86-64',
  },
  arm64: {
    arch: 'arm64',
    target: 'linux-arm64',
    dockerPlatform: 'linux/arm64',
    elfMachine: 183,
    cpu: 'armv8-a',
  },
};
export function linuxTarget(arch) {
  const target = Object.hasOwn(targets, arch) ? targets[arch] : undefined;
  if (!target) throw new Error(`Unsupported Linux architecture: ${arch}. Expected x64 or arm64.`);
  return target;
}
export function parseLinuxTarget(args) {
  if (args.length === 0) return linuxTarget('x64');
  if (args.length !== 1 || !args[0].startsWith('--arch='))
    throw new Error('Usage: --arch=x64 or --arch=arm64');
  return linuxTarget(args[0].slice('--arch='.length));
}
