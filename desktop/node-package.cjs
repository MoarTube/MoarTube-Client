const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');
const { verifyNodeRuntime } = require('./node-runtime.cjs');

async function verifyNodePackage({
  root,
  resources,
  executable,
  release,
  electronVersion,
  target,
}) {
  if (fs.existsSync(path.join(resources, 'node')))
    throw new Error('Electron-hosted bundles must not ship a loose Node tree.');
  const bundle = JSON.parse(fs.readFileSync(path.join(resources, 'bundle.json'), 'utf8'));
  if (bundle.runtimeHost !== 'electron' || bundle.electronVersion !== electronVersion)
    throw new Error('Bundled Node was staged for a different Electron runtime.');
  const digest = (data) => createHash('sha256').update(data).digest('hex');
  const source = bundle.applicationSource;
  if (
    !source ||
    source.target !== target ||
    path.basename(source.archive) !== source.archive ||
    digest(fs.readFileSync(path.join(release, source.archive))) !== source.sha256
  )
    throw new Error('The matching Client + Node source archive is missing or changed.');
  for (const [name, expected] of Object.entries(source.runtimeFiles ?? {})) {
    const file = path.resolve(resources, name);
    if (!file.startsWith(resources + path.sep)) throw new Error('Invalid packaged source path');
    const content = name.startsWith('node.asar/')
      ? asar.extractFile(
          path.join(resources, 'node.asar'),
          path.normalize(name.slice('node.asar/'.length))
        )
      : fs.readFileSync(file);
    if (digest(content) !== expected)
      throw new Error(`Packaged ${name} does not match its source archive.`);
  }
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const { FuseState } = require('@electron/fuses/dist/constants');
  const wire = await getCurrentFuseWire(executable);
  if (wire[FuseV1Options.RunAsNode] !== FuseState.ENABLE)
    throw new Error('Electron RunAsNode must remain enabled for cluster workers.');
  const verified = verifyNodeRuntime(root, path.join(resources, 'node.asar'), executable);
  for (const key of [
    'electronVersion',
    'runtimeVersion',
    'sqlitePackageVersion',
    'sqliteVersion',
    'cloudflaredVersion',
  ])
    if (verified[key] !== bundle[key])
      throw new Error(`Packaged Node ${key} differs from staging.`);
  console.log('Packaged Electron-hosted Node native preflight passed', verified);
}
module.exports = { verifyNodePackage };
