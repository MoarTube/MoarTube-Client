const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const selectionPath = path.join(root, 'build/desktop/ffmpeg-selection.json');
if (!fs.existsSync(selectionPath)) throw new Error('Run npm run desktop:prepare first.');
const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
const directory = path.resolve(selection.runtimeDirectory);
if (
  !directory.startsWith(path.join(root, 'build/desktop/ffmpeg-release-')) ||
  path.basename(directory) !== 'runtime'
)
  throw new Error('Invalid desktop FFmpeg candidate path');
module.exports = {
  appId: 'com.moartube.client',
  productName: 'MoarTube Client',
  executableName: 'MoarTube Client',
  directories: { output: 'build/desktop/output', buildResources: 'desktop' },
  extraMetadata: { main: 'desktop/main.cjs' },
  files: [
    'dist/**/*',
    'desktop/main.cjs',
    'desktop/policy.cjs',
    'desktop/linux-processes.cjs',
    'desktop/loading.html',
    'package.json',
    '!dist/**/*.map',
    '!dist/**/*.d.ts',
  ],
  asar: true,
  asarUnpack: ['**/*.node', 'node_modules/@img/**/*'],
  npmRebuild: false,
  extraResources: [
    { from: directory, to: 'ffmpeg/win32-x64', filter: ['**/*'] },
    { from: 'LICENSE.md', to: 'MoarTube-LICENSE.md' },
  ],
  forceCodeSigning: false,
  artifactName: 'MoarTube-Client-${version}-windows-${arch}.${ext}',
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
    icon: path.join(root, 'build/desktop/icon.ico'),
    signExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    artifactName: 'MoarTube-Client-${version}-windows-${arch}-setup.${ext}',
  },
  publish: null,
};
