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
module.exports = { isLocalNavigation, isExternalLink, readyOrigin, allowPermission };
