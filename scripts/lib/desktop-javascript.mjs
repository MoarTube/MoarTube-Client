import { build } from 'esbuild';
import { builtinModules, createRequire } from 'node:module';
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  lstatSync,
} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  desktopRuntimeManifest,
  desktopRuntimeFileReason,
  isLicenseNotice,
} from './desktop-runtime-dependencies.mjs';

// These packages use native binaries, worker entry points, generated-code
// requires, or files located relative to their own package. Preserve their
// complete production dependency trees instead of rewriting those contracts.
export const desktopExternals = [
  '@imagemagick/magick-wasm',
  'systeminformation',
  'better-sqlite3',
  'fastify',
  '@fastify/*',
  'pino',
  'pino-pretty',
  'ejs',
];

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const packageName = (name) =>
  name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
// ws probes these accelerators inside try/catch and has a JavaScript fallback.
const optionalExternals = new Set(['bufferutil', 'utf-8-validate']);

function resolvePackage(name, importer) {
  const require = createRequire(path.join(importer, 'package.json'));
  for (const directory of require.resolve.paths(name) ??
    require.resolve.paths('__desktop_dependency__') ??
    []) {
    const candidate = path.join(directory, name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(`Missing desktop runtime dependency ${name} from ${importer}`);
}

export async function bundleDesktopJavaScript({
  source,
  destination,
  entries,
  copy = [],
  external = desktopExternals,
  pruneManifest = true,
  platform = process.platform,
  arch = process.arch,
  additionalDependencies = [],
}) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  mkdirSync(destination, { recursive: true });
  for (const name of copy)
    cpSync(path.join(source, name), path.join(destination, name), { recursive: true });

  const names = new Set(additionalDependencies);
  const vendors = new Map();
  const isExternal = (specifier) =>
    external.some((pattern) =>
      pattern.endsWith('/*')
        ? specifier.startsWith(pattern.slice(0, -1))
        : specifier === pattern || specifier.startsWith(`${pattern}/`)
    );
  // Keep application code and parameter names intact: Awilix CLASSIC resolves
  // constructor arguments by name. Rebundling that code can rename arguments
  // when dependencies introduce a conflicting identifier.
  for (const entry of entries) {
    const input = readFileSync(path.join(source, entry), 'utf8');
    const syntax = ts.createSourceFile(
      entry,
      input,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const replacements = [];
    function visit(node) {
      const imported =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : undefined;
      if (
        imported &&
        ts.isStringLiteral(imported) &&
        !builtins.has(imported.text) &&
        !imported.text.startsWith('.')
      ) {
        const specifier = imported.text;
        if (isExternal(specifier)) names.add(packageName(specifier));
        else {
          if (!vendors.has(specifier))
            vendors.set(specifier, {
              id: `dependency-${vendors.size}`,
              exports: new Set(),
              star: false,
            });
          const vendor = vendors.get(specifier);
          const clause = node.importClause;
          if (clause?.name) vendor.exports.add('default');
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
            for (const item of clause.namedBindings.elements)
              vendor.exports.add((item.propertyName ?? item.name).text);
          if (
            !ts.isImportDeclaration(node) ||
            (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
          )
            vendor.star = true;
          const relative = path
            .relative(path.dirname(entry), path.join('vendor', `${vendor.id}.js`))
            .replaceAll('\\', '/');
          replacements.push({
            start: imported.getStart(syntax),
            end: imported.end,
            text: JSON.stringify(relative.startsWith('.') ? relative : `./${relative}`),
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    let rewritten = input;
    for (const item of replacements.sort((a, b) => b.start - a.start))
      rewritten = rewritten.slice(0, item.start) + item.text + rewritten.slice(item.end);
    const output = path.join(destination, entry);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, rewritten);
  }
  const result = await build({
    absWorkingDir: source,
    entryPoints: Object.fromEntries(
      [...vendors].map(([specifier, vendor]) => [vendor.id, `desktop-vendor:${specifier}`])
    ),
    outdir: path.join(destination, 'vendor'),
    splitting: true,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external,
    plugins: [
      {
        name: 'desktop-vendor',
        setup(plugin) {
          plugin.onResolve({ filter: /^desktop-vendor:/ }, (args) => ({
            path: args.path.slice('desktop-vendor:'.length),
            namespace: 'desktop-vendor',
          }));
          plugin.onLoad({ filter: /.*/, namespace: 'desktop-vendor' }, (args) => {
            const vendor = vendors.get(args.path);
            return {
              contents:
                (vendor.exports.size
                  ? `export { ${[...vendor.exports].join(', ')} } from ${JSON.stringify(args.path)};\n`
                  : '') +
                (vendor.star ? `export * from ${JSON.stringify(args.path)};\n` : '') +
                (!vendor.exports.size && !vendor.star
                  ? `import ${JSON.stringify(args.path)};`
                  : ''),
              resolveDir: source,
            };
          });
        },
      },
    ],
    // Bundled CommonJS libraries still need Node's require for builtins and
    // explicitly external packages. ESM entry points retain import.meta.url.
    banner: {
      js: "import { createRequire as __desktopCreateRequire } from 'node:module';\nvar require = __desktopCreateRequire(import.meta.url);",
    },
    metafile: true,
    sourcemap: false,
    legalComments: 'eof',
    logLevel: 'warning',
  });
  for (const output of Object.values(result.metafile.outputs))
    for (const item of output.imports)
      if (item.external && !builtins.has(item.path) && !item.path.startsWith('.'))
        names.add(packageName(item.path));
  // Pino resolves transports by name in its worker, outside esbuild's graph.
  if (names.has('pino')) names.add('pino-pretty');
  for (const name of names) {
    try {
      resolvePackage(name, source);
    } catch (error) {
      if (optionalExternals.has(name)) names.delete(name);
      else throw error;
    }
  }

  const visited = new Set();
  const omittedDependencies = [];
  const omittedPackageContents = [];
  const nativeBuildNotices = new Set();
  function copyPackage(name, importer, optional = false) {
    let directory;
    try {
      directory = resolvePackage(name, importer);
    } catch (error) {
      if (optional) return;
      throw error;
    }
    copyPackageDirectory(directory);
  }
  function copyPackageDirectory(directory) {
    if (visited.has(directory)) return;
    visited.add(directory);
    const relative = path.relative(source, directory);
    if (!relative.startsWith(`node_modules${path.sep}`))
      throw new Error(`Desktop dependency is outside its isolated tree: ${directory}`);
    const original = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const profile = desktopRuntimeManifest(original, { platform, arch });
    const { omittedDependencies: omissions } = profile;
    const manifest = profile.manifest;
    omittedDependencies.push(...omissions);
    // node-addon-api is build-only, but inline header code is compiled into the
    // SQLite binary. Keep its attribution after removing its runtime tree.
    if (omissions.some((item) => item.dependency === 'node-addon-api'))
      nativeBuildNotices.add(resolvePackage('node-addon-api', directory));
    const output = path.join(destination, relative);
    // Notices sometimes live inside an otherwise unused docs/source folder.
    // Retain them even when that folder is excluded from the runtime copy.
    function retainNotices(folder) {
      for (const item of readdirSync(folder, { withFileTypes: true })) {
        if (item.name === 'node_modules') continue;
        const file = path.join(folder, item.name);
        if (item.isDirectory()) retainNotices(file);
        else if (item.isFile() && isLicenseNotice(item.name)) {
          const target = path.join(output, path.relative(directory, file));
          mkdirSync(path.dirname(target), { recursive: true });
          copyFileSync(file, target);
        }
      }
    }
    cpSync(directory, output, {
      recursive: true,
      filter(file) {
        if (file === directory) return true;
        const relativeFile = path.relative(directory, file).replaceAll('\\', '/');
        if (relativeFile.split('/').includes('node_modules')) return false;
        const reason = desktopRuntimeFileReason(relativeFile, profile);
        if (!reason) return true;
        if (lstatSync(file).isDirectory()) retainNotices(file);
        omittedPackageContents.push({
          package: `${original.name}@${original.version}`,
          path: relativeFile,
          reason,
        });
        return false;
      },
    });
    if (manifest !== original)
      writeFileSync(path.join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      copyPackage(dependency, directory, dependency in (manifest.optionalDependencies ?? {}));
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {}))
      copyPackage(dependency, directory, true);
    for (const dependency of Object.keys(manifest.peerDependencies ?? {}))
      copyPackage(
        dependency,
        directory,
        manifest.peerDependenciesMeta?.[dependency]?.optional === true
      );
  }
  for (const name of names) copyPackage(name, source);

  // Consolidate bundled packages' notices rather than discarding attribution
  // when their individual package directories disappear from the installer.
  const bundledPackages = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    let directory = path.dirname(path.resolve(source, input));
    while (directory !== source && directory !== path.dirname(directory)) {
      if (existsSync(path.join(directory, 'package.json'))) {
        const metadata = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
        if (metadata.name && metadata.version) {
          if (directory.includes(`${path.sep}node_modules${path.sep}`))
            bundledPackages.add(directory);
          break;
        }
      }
      directory = path.dirname(directory);
    }
  }
  const notices = [];
  for (const directory of [...new Set([...bundledPackages, ...nativeBuildNotices])].sort()) {
    const metadata = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    notices.push(
      `\n=== ${metadata.name}@${metadata.version} (${metadata.license ?? 'see notice'}) ===\n`
    );
    for (const file of readdirSync(directory, { withFileTypes: true }))
      if (
        file.isFile() &&
        /^(licen[sc]e|copying|notice|copyright)([._-]|notice|$)/i.test(file.name)
      )
        notices.push(
          `--- ${file.name} ---\n${readFileSync(path.join(directory, file.name), 'utf8')}\n`
        );
  }
  writeFileSync(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
  const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(
    [...names]
      .sort()
      .map((name) => [
        name,
        JSON.parse(readFileSync(path.join(resolvePackage(name, source), 'package.json'), 'utf8'))
          .version,
      ])
  );
  writeFileSync(
    path.join(destination, 'package.json'),
    JSON.stringify(
      pruneManifest
        ? {
            ...manifest,
            dependencies,
            devDependencies: {},
            optionalDependencies: {},
            scripts: {},
          }
        : manifest,
      null,
      2
    ) + '\n'
  );
  return {
    bundledPackages: bundledPackages.size,
    externalPackages: visited.size,
    dependencies,
    omittedDependencies,
    omittedPackageContents,
  };
}
