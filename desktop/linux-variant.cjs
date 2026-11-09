const path = require('node:path');
const { desktopPaths } = require('../tooling/build-paths.cjs');

function linuxVariant(value) {
  if (!['client', 'bundled'].includes(value))
    throw new Error(`Unknown Linux desktop variant: ${value}`);
  const bundled = value === 'bundled';
  return {
    name: value,
    bundled,
    prefix: bundled ? 'MoarTube-Client-Node' : 'MoarTube-Client',
    productName: bundled ? 'MoarTube Client + Node' : 'MoarTube Client',
    appId: bundled ? 'com.moartube.desktop' : 'com.moartube.client',
    executable: bundled ? 'moartube-client-node-desktop' : 'moartube-client-desktop',
    packageName: bundled ? 'moartube-client-node' : 'moartube-client',
    desktopName: bundled ? 'moartube-client-node.desktop' : 'moartube-client.desktop',
  };
}
function linuxPaths(root, arch, version, variant) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Linux architecture: ${arch}`);
  const selected = linuxVariant(variant);
  const layout = desktopPaths(root, `linux-${arch}`, version);
  return {
    ...layout,
    packages: path.join(layout.packages, selected.name),
    reports: path.join(layout.reports, selected.name),
  };
}
function parseLinuxDesktopArgs(args, defaultVariant = 'all') {
  if (
    args.some(
      (arg) => !arg.startsWith('--arch=') && !arg.startsWith('--variant=') && arg !== '--dir'
    )
  )
    throw new Error('Usage: --arch=x64|arm64 --variant=client|bundled|all [--dir]');
  const arch =
    args.find((arg) => arg.startsWith('--arch='))?.slice(7) ??
    process.env.MOARTUBE_DESKTOP_ARCH ??
    (process.platform === 'linux' ? process.arch : 'x64');
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Linux architecture: ${arch}`);
  const variant =
    args.find((arg) => arg.startsWith('--variant='))?.slice(10) ??
    process.env.MOARTUBE_DESKTOP_VARIANT ??
    defaultVariant;
  const variants = variant === 'all' ? ['client', 'bundled'] : [linuxVariant(variant).name];
  return {
    arch,
    target: `linux-${arch}`,
    dockerPlatform: arch === 'arm64' ? 'linux/arm64' : 'linux/amd64',
    variant,
    variants,
    dir: args.includes('--dir'),
  };
}
module.exports = { linuxVariant, linuxPaths, parseLinuxDesktopArgs };
