const path = require('node:path');
const { desktopPaths } = require('../tooling/build-paths.cjs');

function darwinVariant(value) {
  if (!['client', 'bundled'].includes(value))
    throw new Error(`Unknown Darwin desktop variant: ${value}`);
  const bundled = value === 'bundled';
  return {
    name: value,
    bundled,
    prefix: bundled ? 'MoarTube-Client-Node' : 'MoarTube-Client',
    productName: bundled ? 'MoarTube Client + Node' : 'MoarTube Client',
    appId: bundled ? 'com.moartube.desktop' : 'com.moartube.client',
    executable: bundled ? 'MoarTube Client + Node' : 'MoarTube Client',
  };
}
function darwinPaths(root, arch, version, variant) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Darwin architecture: ${arch}`);
  const selected = darwinVariant(variant);
  const layout = desktopPaths(root, `darwin-${arch}`, version);
  return {
    ...layout,
    packages: path.join(layout.packages, selected.name),
    reports: path.join(layout.reports, selected.name),
  };
}
function parseDarwinDesktopArgs(args, defaultVariant = 'all') {
  if (
    args.some(
      (arg) =>
        !/^--arch=(x64|arm64)$/.test(arg) &&
        !/^--variant=(client|bundled|all)$/.test(arg) &&
        arg !== '--dir'
    )
  )
    throw new Error('Usage: --arch=x64|arm64 --variant=client|bundled|all [--dir]');
  for (const key of ['--arch=', '--variant='])
    if (args.filter((arg) => arg.startsWith(key)).length > 1)
      throw new Error(`Duplicate Darwin option: ${key}`);
  const arch =
    args.find((arg) => arg.startsWith('--arch='))?.slice(7) ??
    process.env.MOARTUBE_DESKTOP_ARCH ??
    (process.platform === 'darwin' ? process.arch : 'x64');
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Darwin architecture: ${arch}`);
  const variant =
    args.find((arg) => arg.startsWith('--variant='))?.slice(10) ??
    process.env.MOARTUBE_DESKTOP_VARIANT ??
    defaultVariant;
  const variants = variant === 'all' ? ['client', 'bundled'] : [darwinVariant(variant).name];
  return { arch, target: `darwin-${arch}`, variant, variants, dir: args.includes('--dir') };
}
module.exports = { darwinVariant, darwinPaths, parseDarwinDesktopArgs };
