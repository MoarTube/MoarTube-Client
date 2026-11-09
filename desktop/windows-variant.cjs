const path = require('node:path');
const { desktopPaths } = require('../tooling/build-paths.cjs');

function windowsVariant(value) {
  if (!['client', 'bundled'].includes(value))
    throw new Error(`Unknown Windows desktop variant: ${value}`);
  return {
    name: value,
    bundled: value === 'bundled',
    prefix: value === 'bundled' ? 'MoarTube-Client-Node' : 'MoarTube-Client',
    productName: value === 'bundled' ? 'MoarTube Client + Node' : 'MoarTube Client',
    appId: value === 'bundled' ? 'com.moartube.desktop' : 'com.moartube.client',
  };
}
function windowsPaths(root, version, variant) {
  const selected = windowsVariant(variant);
  const layout = desktopPaths(root, 'win32-x64', version);
  return { ...layout, packages: path.join(layout.packages, selected.name) };
}
module.exports = { windowsVariant, windowsPaths };
