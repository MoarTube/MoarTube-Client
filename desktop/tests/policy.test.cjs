const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  supportsDesktopTarget,
  isLocalNavigation,
  isExternalLink,
  readyOrigin,
  allowPermission,
} = require('../policy.cjs');

test('startup accepts Apple Silicon and the other packaged targets while rejecting unsupported hosts', () => {
  for (const [platform, arch] of [
    ['win32', 'x64'],
    ['linux', 'x64'],
    ['linux', 'arm64'],
    ['darwin', 'x64'],
    ['darwin', 'arm64'],
  ])
    assert.equal(supportsDesktopTarget(platform, arch), true, `${platform}-${arch}`);
  for (const [platform, arch] of [
    ['win32', 'arm64'],
    ['darwin', 'ia32'],
    ['linux', 'arm'],
    ['freebsd', 'x64'],
  ])
    assert.equal(supportsDesktopTarget(platform, arch), false, `${platform}-${arch}`);
});

test('only accepts a private loopback backend readiness message', () => {
  assert.equal(
    readyOrigin({ type: 'ready', url: 'http://127.0.0.1:45000' }),
    'http://127.0.0.1:45000'
  );
  for (const url of [
    'http://example.com:45000',
    'file:///tmp/app.html',
    'javascript:alert(1)',
    'http://127.0.0.1:0',
    'http://user:pass@127.0.0.1:45000',
    'http://127.0.0.1:45000/other',
  ])
    assert.equal(readyOrigin({ type: 'ready', url }), undefined);
  assert.equal(readyOrigin({ type: 'error', url: 'http://127.0.0.1:45000' }), undefined);
});

test('keeps navigation on the exact backend origin', () => {
  assert.equal(isLocalNavigation('http://127.0.0.1:45000/videos', 'http://127.0.0.1:45000'), true);
  for (const url of [
    'http://127.0.0.1:45001',
    'https://127.0.0.1:45000',
    'http://127.0.0.1.evil.test:45000',
    'file:///C:/Windows',
  ])
    assert.equal(isLocalNavigation(url, 'http://127.0.0.1:45000'), false);
});

test('never sends local files or executable URL schemes to the OS', () => {
  assert.equal(isExternalLink('https://www.moartube.com/'), true);
  assert.equal(isExternalLink('http://localhost:9090/watch/video'), true);
  for (const url of [
    'file:///C:/Windows',
    'javascript:alert(1)',
    'ms-settings:display',
    'https://user:pass@evil.test',
    'not a URL',
  ])
    assert.equal(isExternalLink(url), false);
});

test('allows copy-link writes from the local UI while denying clipboard reads and device permissions', () => {
  const origin = 'http://127.0.0.1:45000';
  assert.equal(allowPermission('clipboard-sanitized-write', `${origin}/videos`, origin), true);
  assert.equal(
    allowPermission('clipboard-sanitized-write', 'https://elsewhere.test', origin),
    false
  );
  for (const permission of ['clipboard-read', 'media', 'geolocation', 'notifications'])
    assert.equal(allowPermission(permission, origin, origin), false);
});
