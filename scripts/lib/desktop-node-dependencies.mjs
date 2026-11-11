import { build } from 'esbuild';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { isLicenseNotice } from './desktop-runtime-dependencies.mjs';

// These are packaging optimizations for the audited Windows Node runtime.
// A package update keeps its original tree until the new version is reviewed.
export async function consolidateDesktopNodeDependencies(destination) {
  destination = path.resolve(destination);
  const modules = path.resolve(destination, 'node_modules');
  const report = { deduplicated: [], bundled: [] };

  function files(directory) {
    return readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
      .sort();
  }

  function removePackage(directory) {
    const relative = path.relative(modules, directory);
    if (
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      lstatSync(directory).isSymbolicLink()
    )
      throw new Error(`Invalid Node package staging path: ${directory}`);
    rmSync(directory, { recursive: true });
  }

  const manifest = (directory) =>
    JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const fingerprint = (directory) =>
    JSON.stringify(
      files(directory).map((file) => [
        path.relative(directory, file),
        createHash('sha256').update(readFileSync(file)).digest('hex'),
      ])
    );

  // Hoist the shared traversal dependency first so AJV resolves the same
  // dependency modules from its original locations and from the shared root.
  for (const [name, version] of [
    ['json-schema-traverse', '1.0.0'],
    ['ajv', '8.17.1'],
  ]) {
    const copies = ['@fastify/ajv-compiler', 'ajv-formats', 'fast-json-stringify']
      .map((parent) => path.join(modules, parent, 'node_modules', name))
      .filter(
        (directory) =>
          existsSync(path.join(directory, 'package.json')) &&
          manifest(directory).version === version
      );
    if (
      copies.length < 2 ||
      copies.some((directory) => existsSync(path.join(directory, 'node_modules')))
    )
      continue;
    const target = path.join(modules, name);
    const present = existsSync(target);
    const signature = fingerprint(copies[0]);
    if (
      (present && fingerprint(target) !== signature) ||
      copies.some((directory) => fingerprint(directory) !== signature)
    )
      continue;
    if (!present) cpSync(copies[0], target, { recursive: true });
    const targetRequire = createRequire(path.join(target, 'package.json'));
    let sameDependencies;
    try {
      sameDependencies = copies.every((directory) => {
        const local = createRequire(path.join(directory, 'package.json'));
        return Object.keys(manifest(directory).dependencies ?? {}).every(
          (dependency) => local.resolve(dependency) === targetRequire.resolve(dependency)
        );
      });
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
      sameDependencies = false;
    }
    if (!sameDependencies) {
      if (!present) removePackage(target);
      continue;
    }
    for (const directory of copies) removePackage(directory);
    report.deduplicated.push({
      package: `${name}@${version}`,
      copiesBefore: copies.length + Number(present),
      copiesAfter: 1,
    });
  }

  for (const [name, version, publicEntries] of [
    ['yaml', '2.8.2', ['.', './util']],
    ['semver', '7.7.3', ['.']],
  ]) {
    const directory = path.join(modules, name);
    if (
      !existsSync(path.join(directory, 'package.json')) ||
      manifest(directory).version !== version
    )
      continue;
    const original = manifest(directory);
    const local = createRequire(path.join(destination, 'package.json'));
    const specifiers = new Set(
      publicEntries.map((entry) => (entry === '.' ? name : name + entry.slice(1)))
    );
    // Preserve any additional subpaths referenced by the current runtime.
    // This includes literal generated-code imports as well as normal imports.
    for (const file of files(destination)) {
      if (file.startsWith(directory + path.sep) || !/\.[cm]?js$/.test(file)) continue;
      const input = readFileSync(file, 'utf8');
      if (!input.includes(name + '/')) continue;
      const syntax = ts.createSourceFile(
        file,
        input,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
      );
      function visit(node) {
        if (ts.isStringLiteralLike(node) && node.text.startsWith(name + '/'))
          specifiers.add(node.text);
        ts.forEachChild(node, visit);
      }
      visit(syntax);
    }
    const entries = [...specifiers]
      .filter((specifier) => !specifier.endsWith('/package.json'))
      .map((specifier) => local.resolve(specifier));
    if (entries.some((entry) => !entry.startsWith(directory + path.sep)))
      throw new Error(`Unexpected ${name} entry point`);
    const retained = files(directory)
      .filter(
        (file) =>
          isLicenseNotice(file.replaceAll('\\', '/')) ||
          path.relative(directory, file).toLowerCase() === 'readme.md'
      )
      .map((file) => [path.relative(directory, file), readFileSync(file)]);
    const uniqueEntries = [...new Set(entries)];
    const bundle = path.join(directory, 'desktop-bundle.cjs');
    // One shared module preserves class identity and module state when callers
    // use both a package root and one of its public subpaths.
    const result = await build({
      stdin: {
        contents: uniqueEntries
          .map(
            (entry) =>
              `exports[${JSON.stringify(path.relative(directory, entry).replaceAll('\\', '/'))}] = require(${JSON.stringify(entry)});`
          )
          .join('\n'),
        resolveDir: directory,
        loader: 'js',
      },
      outfile: bundle,
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      write: false,
      allowOverwrite: true,
      legalComments: 'eof',
      logLevel: 'warning',
    });
    removePackage(directory);
    for (const [relative, data] of retained) {
      mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
      writeFileSync(path.join(directory, relative), data);
    }
    for (const output of result.outputFiles) {
      mkdirSync(path.dirname(output.path), { recursive: true });
      writeFileSync(output.path, output.contents);
    }
    for (const entry of uniqueEntries) {
      mkdirSync(path.dirname(entry), { recursive: true });
      let relative = path.relative(path.dirname(entry), bundle).replaceAll('\\', '/');
      if (!relative.startsWith('.')) relative = './' + relative;
      const key = path.relative(directory, entry).replaceAll('\\', '/');
      writeFileSync(
        entry,
        `module.exports = require(${JSON.stringify(relative)})[${JSON.stringify(key)}];\n`
      );
    }
    const packaged = { ...original, type: 'commonjs', scripts: {}, devDependencies: {} };
    delete packaged.bin;
    delete packaged.browser;
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify(packaged, null, 2) + '\n');
    report.bundled.push({ package: `${name}@${version}`, entries: [...specifiers] });
  }
  return report;
}
