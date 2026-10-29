const { mkdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');

// Downloaded builder CLIs use CommonJS .js files. A cache inside this ESM
// repository must establish its own package scope before those tools execute.
function prepareBuilderCache(directory) {
  if (!directory?.trim()) return;
  directory = directory.trim();
  if (!path.isAbsolute(directory))
    throw new Error('ELECTRON_BUILDER_CACHE must be an absolute path.');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'package.json');
  const manifest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (manifest.type !== 'commonjs' || manifest.private !== true)
    writeFileSync(
      file,
      JSON.stringify({ ...manifest, private: true, type: 'commonjs' }, null, 2) + '\n'
    );
}

module.exports = { prepareBuilderCache };
