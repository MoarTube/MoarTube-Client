const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const selection = JSON.parse(
  fs.readFileSync(path.join(root, 'build/desktop/ffmpeg-selection-linux.json'), 'utf8')
);
const directory = path.resolve(selection.runtimeDirectory);
if (
  !directory.startsWith(path.join(root, 'build/desktop/ffmpeg-release-')) ||
  path.basename(directory) !== 'runtime'
)
  throw new Error('Run npm run desktop:prepare:linux to select a verified Linux FFmpeg candidate');
module.exports = {
  appId: 'com.moartube.client',
  productName: 'MoarTube Client',
  // Keep the existing npm CLI command available alongside the desktop option.
  executableName: 'moartube-client-desktop',
  directories: { output: 'build/desktop/output/linux', buildResources: 'desktop' },
  extraMetadata: { main: 'desktop/main.cjs', desktopName: 'moartube-client.desktop' },
  files: [
    'dist/**/*',
    'desktop/main.cjs',
    'desktop/policy.cjs',
    'desktop/linux-processes.cjs',
    'desktop/loading.html',
    'package.json',
    '!dist/**/*.map',
    '!dist/**/*.d.ts',
    { from: 'build/desktop/icon.png', to: 'desktop/icon.png' },
  ],
  asar: true,
  asarUnpack: ['**/*.node', 'node_modules/@img/**/*'],
  npmRebuild: false,
  extraResources: [
    { from: directory, to: 'ffmpeg/linux-x64', filter: ['**/*'] },
    { from: 'LICENSE.md', to: 'MoarTube-LICENSE.md' },
  ],
  artifactName: 'MoarTube-Client-${version}-linux-${arch}.${ext}',
  linux: {
    syncDesktopName: true,
    target: [
      { target: 'deb', arch: ['x64'] },
      { target: 'tar.gz', arch: ['x64'] },
    ],
    icon: path.join(root, 'build/desktop/icon.png'),
    category: 'AudioVideo',
    maintainer: 'MoarTube, LLC',
    synopsis: 'MoarTube video publishing and live streaming client',
  },
  deb: {
    artifactName: 'MoarTube-Client-${version}-linux-x64.deb',
    packageName: 'moartube-client',
    depends: [
      'libc6 (>= 2.39)',
      'libgtk-3-0t64',
      'libnss3',
      'libnspr4',
      'libxss1',
      'libxtst6',
      'libatspi2.0-0t64',
      'libuuid1',
      'libgbm1',
      'libasound2t64',
      'libx11-xcb1',
      'libnotify4',
      'libsecret-1-0',
      'xdg-utils',
      'libva2',
      'libva-drm2',
      'libdrm2',
      'libgnutls30t64',
      'ca-certificates',
    ],
  },
  publish: null,
};
