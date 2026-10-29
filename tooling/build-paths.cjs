const path = require('node:path');

function targetName(target) {
  if (!['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].includes(target))
    throw new Error(`Unsupported build target: ${target}`);
  return target;
}
function ffmpegPaths(root, target) {
  targetName(target);
  const base = path.join(root, 'build/ffmpeg');
  const state = path.join(base, 'state', target);
  return {
    base,
    target,
    sources: path.join(base, 'cache/sources'),
    toolchainDownloads: path.join(base, 'cache/toolchains', target),
    toolchain: path.join(base, 'toolchains', target),
    work: path.join(base, 'work', target),
    install: path.join(base, 'install', target),
    candidates: path.join(base, 'candidates', target),
    releases: path.join(base, 'releases', target),
    reports: path.join(base, 'reports', target),
    logs: path.join(base, 'logs', target),
    state,
    selection: path.join(state, 'selected.json'),
  };
}
function desktopPaths(root, target, version) {
  targetName(target);
  if (version !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version))
    throw new Error('Invalid desktop version');
  const base = path.join(root, 'build/desktop');
  const work = path.join(base, 'work', target);
  const state = path.join(base, 'state', target);
  return {
    base,
    target,
    work,
    packages: path.join(work, 'packages'),
    staging: path.join(work, 'staging'),
    assets: path.join(base, 'assets'),
    cache: path.join(base, 'cache'),
    release: path.join(base, 'releases', target, ...(version === undefined ? [] : [version])),
    reports: path.join(base, 'reports', target),
    profiles: path.join(base, 'profiles', target),
    logs: path.join(base, 'logs', target),
    state,
    selection: path.join(state, 'ffmpeg-selection.json'),
  };
}
module.exports = { ffmpegPaths, desktopPaths };
