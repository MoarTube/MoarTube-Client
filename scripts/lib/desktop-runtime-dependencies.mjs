// Apply only to audited versions. A dependency upgrade falls back to shipping
// its full production tree until its runtime imports can be audited again.
const rules = {
  ejs: {
    versions: ['3.1.10', '4.0.1'],
    dependencies: { jake: 'Used by the EJS CLI and build tasks, not template rendering.' },
    files: ['bin'],
    removeBin: true,
  },
  'better-sqlite3': {
    versions: ['12.6.0', '13.0.3'],
    dependencies: {
      'prebuild-install':
        'Downloads the native addon during installation; the desktop ships the verified addon.',
      'node-addon-api': 'C++ headers used to build the addon; the desktop ships the verified Node-API binary.',
    },
    files: [
      'prebuilds/darwin-arm64.node', 'prebuilds/darwin-x64.node',
      'prebuilds/linux-arm64.node', 'prebuilds/linux-x64.node',
      'prebuilds/linuxmusl-arm64.node', 'prebuilds/linuxmusl-x64.node',
      'prebuilds/win32-arm64.node',
    ],
  },
  '@fastify/swagger': {
    versions: ['9.6.1'],
    dependencies: { 'openapi-types': 'Referenced by TypeScript declarations only.' },
    files: [],
  },
  '@fastify/swagger-ui': {
    versions: ['5.2.4', '5.2.5'],
    dependencies: { 'openapi-types': 'Referenced by TypeScript declarations only.' },
    files: [],
  },
  'pino-pretty': {
    versions: ['13.1.3'],
    dependencies: {
      'help-me': 'Used by bin.js for command-line help only.',
      joycon: 'Used by bin.js to discover command-line configuration only.',
      minimist: 'Used by bin.js to parse command-line arguments only.',
      'strip-json-comments': 'Used by bin.js to parse command-line configuration only.',
    },
    files: ['bin.js', 'help'],
    removeBin: true,
  },
};

// All of these versions expose compiled JavaScript entry points. Their type
// tests, source TypeScript, documentation and tool configuration are not loaded
// by the application. Keep this audit separate from dependency-edge pruning.
const contentVersions = {
  '@fastify/ajv-compiler': ['4.0.5'],
  '@fastify/cookie': ['11.0.2'],
  '@fastify/cors': ['11.2.0'],
  '@fastify/error': ['4.2.0'],
  '@fastify/fast-json-stringify-compiler': ['5.0.3'],
  '@fastify/formbody': ['8.0.2'],
  '@fastify/merge-json-schemas': ['0.2.1'],
  '@fastify/multipart': ['9.3.0', '9.4.0'],
  '@fastify/proxy-addr': ['5.1.0'],
  '@fastify/send': ['4.1.0'],
  '@fastify/static': ['9.0.0'],
  '@fastify/swagger': ['9.6.1'],
  '@fastify/swagger-ui': ['5.2.4', '5.2.5'],
  '@fastify/view': ['11.1.1'],
  '@fastify/websocket': ['11.2.0'],
  '@pinojs/redact': ['0.4.0'],
  ajv: ['8.17.1', '8.20.0'],
  'ajv-formats': ['3.0.1'],
  'better-sqlite3': ['12.6.0', '13.0.3'],
  'fast-json-stringify': ['6.1.1', '6.2.0'],
  'fast-uri': ['3.1.0'],
  fastify: ['5.6.2', '5.7.2'],
  'fastify-plugin': ['5.1.0'],
  'json-schema-ref-resolver': ['3.0.0'],
  'json-schema-traverse': ['1.0.0'],
  'light-my-request': ['6.6.0'],
  pino: ['10.1.1', '10.3.0'],
  'pino-pretty': ['13.1.3'],
  'process-warning': ['4.0.1', '5.0.0'],
  rfdc: ['1.4.1'],
  'safe-regex2': ['5.0.0'],
  'secure-json-parse': ['4.1.0'],
  sharp: ['0.33.5'],
  'sonic-boom': ['4.2.0'],
};
const contentDirectories = {
  '@fastify/view': ['templates', 'benchmark.js'], // Fixtures for its own tests/examples.
  'ajv-formats': ['src'], // Runtime imports use dist/.
  'better-sqlite3': ['src', 'deps', 'binding.gyp'], // Addon remains in build/Release/ or prebuilds/.
  'fast-json-stringify': ['build'], // Prebuilt validator is in lib/schema-validator.js.
  'json-schema-traverse': ['spec'], // Not Swagger's runtime lib/spec/.
  sharp: ['install'], // Keep src/build/Release/ as a supported native-addon location.
  'sonic-boom': ['fixtures'],
};

export function isLicenseNotice(name) {
  return /^(licen[sc]e|copying|notice|copyright|third.?party)/i.test(name.split('/').at(-1));
}

export function desktopRuntimeFileReason(relative, profile) {
  const name = relative.replaceAll('\\', '/');
  if (isLicenseNotice(name)) return undefined;
  for (const excluded of profile.excludedFiles)
    if (name === excluded || name.startsWith(`${excluded}/`))
      return 'Unused CLI/build/package material';
  if (!profile.pruneDevelopmentFiles) return undefined;
  const [root] = name.split('/');
  if (
    ['docs', 'types', 'test-types', 'test-d', 'e2e', '.github', '.circleci', '.vscode'].includes(
      root
    )
  )
    return 'Documentation, type tests or development configuration';
  if (/\.(test|spec)\.[cm]?[jt]sx?$|\.test-d\.[cm]?ts$/.test(name)) return 'Adjacent test file';
  if (/\.[cm]?tsx?$/.test(name)) return 'TypeScript source; compiled JavaScript is retained';
  if (profile.nativeSource && /^src\//.test(name) && /\.(c|cc|cpp|h|hpp)$/.test(name))
    return 'Native build source; compiled addon is retained';
  if (
    !name.includes('/') &&
    (/^\.(eslint|prettier|tap|nyc|c8|runkit)/.test(name) ||
      /^(eslint\.config\.[cm]?js|tsconfig(?:\.[\w-]+)?\.json|Makefile|GNUmakefile|benchmark\.[cm]?js|bench\.[cm]?js)$/.test(
        name
      ))
  )
    return 'Development tool configuration or benchmark';
  return undefined;
}

export function desktopRuntimeManifest(original) {
  const dependencyRule = rules[original.name];
  const rule = dependencyRule?.versions.includes(original.version) ? dependencyRule : undefined;
  const pruneDevelopmentFiles = contentVersions[original.name]?.includes(original.version) === true;
  if (!rule && !pruneDevelopmentFiles)
    return { manifest: original, excludedFiles: [], omittedDependencies: [] };
  const manifest = { ...original, dependencies: { ...original.dependencies }, scripts: {} };
  const omittedDependencies = [];
  for (const [dependency, reason] of Object.entries(rule?.dependencies ?? {})) {
    if (!(dependency in manifest.dependencies)) continue;
    delete manifest.dependencies[dependency];
    omittedDependencies.push({
      package: `${original.name}@${original.version}`,
      dependency,
      reason,
    });
  }
  if (rule?.removeBin) delete manifest.bin;
  return {
    manifest,
    excludedFiles: [
      ...(rule?.files ?? []),
      ...(pruneDevelopmentFiles ? (contentDirectories[original.name] ?? []) : []),
    ],
    omittedDependencies,
    pruneDevelopmentFiles,
    nativeSource: pruneDevelopmentFiles && original.name === 'sharp',
  };
}
