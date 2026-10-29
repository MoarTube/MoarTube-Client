function supportsDesktopTarget(platform, arch) {
  return (
    (platform === 'win32' && arch === 'x64') ||
    (['linux', 'darwin'].includes(platform) && ['x64', 'arm64'].includes(arch))
  );
}

function isLocalNavigation(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
function isExternalLink(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
function readyOrigin(message) {
  if (!message || message.type !== 'ready' || typeof message.url !== 'string') return undefined;
  try {
    const url = new URL(message.url);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      Number(url.port) < 1 ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
function allowPermission(permission, url, origin) {
  return permission === 'clipboard-sanitized-write' && isLocalNavigation(url, origin);
}
module.exports = {
  supportsDesktopTarget,
  isLocalNavigation,
  isExternalLink,
  readyOrigin,
  allowPermission,
};
