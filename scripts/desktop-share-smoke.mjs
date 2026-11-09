import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopPaths } from '../tooling/build-paths.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const layout = desktopPaths(root, `${process.platform}-${process.arch}`);
const profile = path.join(layout.profiles, `share-preview-${Date.now()}`);
mkdirSync(profile, { recursive: true });
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const ffmpegDirectory = executablePath
  ? path.join(path.dirname(executablePath), 'resources/ffmpeg', layout.target)
  : undefined;
const selection = executablePath ? undefined : JSON.parse(readFileSync(layout.selection, 'utf8'));
const ffmpegManifest = executablePath
  ? JSON.parse(readFileSync(path.join(ffmpegDirectory, 'manifest.json'), 'utf8'))
  : undefined;
const ffmpeg = executablePath
  ? path.join(ffmpegDirectory, ffmpegManifest.files.ffmpeg.path)
  : path.join(
      selection.runtimeDirectory,
      selection.buildId,
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );
const videoFile = path.join(profile, 'fixture.mp4');
execFileSync(
  ffmpeg,
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=magenta:s=320x180:r=24',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    videoFile,
  ],
  { windowsHide: true }
);
const video = readFileSync(videoFile);

const environment = {
  ...process.env,
  MOARTUBE_DESKTOP_BUNDLED: '1',
  MOARTUBE_DESKTOP_SMOKE: '1',
  MOARTUBE_DESKTOP_TEST_DATA_DIR: profile,
};
delete environment.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({
  chromiumSandbox: true,
  ...(executablePath ? { executablePath } : {}),
  args: executablePath ? [] : [path.join(root, 'desktop/main.cjs')],
  env: environment,
  timeout: 30_000,
});
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(15_000);
  await page.waitForURL(/\/videos$/, { timeout: 180_000 });
  const violations = [];
  await page.evaluate(() => {
    window.shareFrameViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.effectiveDirective === 'frame-src')
        window.shareFrameViolations.push(event.blockedURI);
    });
  });
  const publicOrigin = 'http://public-node.test:3000';
  const tunnelOrigin = 'https://share-preview.trycloudflare.com';
  await page.route(
    (url) => url.pathname === '/settings/node',
    (route) =>
      route.fulfill({
        json: {
          publicNodeProtocol: 'http',
          publicNodeAddress: 'public-node.test',
          publicNodePort: 3000,
          isCloudflareTunnelEnabled: true,
          isCloudflareCdnEnabled: false,
        },
      })
  );
  await page.route(
    (url) => url.pathname === '/settings/node/cloudflare/tunnel',
    (route) =>
      route.fulfill({
        json: {
          tunnel: { mode: 'quick', status: 'running', publicUrl: tunnelOrigin },
        },
      })
  );
  await page.route('**/videos/desktop-share/sources', (route) =>
    route.fulfill({
      json: {
        sources: { adaptiveSources: [], progressiveSources: [] },
      },
    })
  );
  for (const origin of [publicOrigin, tunnelOrigin]) {
    await page.route(`${origin}/**`, async (route) => {
      if (new URL(route.request().url()).pathname === '/fixture.mp4') {
        await route.fulfill({ contentType: 'video/mp4', body: video });
      } else {
        await route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><body><video id="preview" controls muted preload="auto" src="/fixture.mp4"></video></body></html>',
        });
      }
    });
  }
  await page.evaluate(() => moarTubeClientVideos.showShareModal('desktop-share'));
  for (const [value, origin] of [
    ['tunnel', tunnelOrigin],
    ['public', publicOrigin],
  ]) {
    await page.locator('#share-address-select').selectOption(value);
    await expect(page.locator('#share-video-preview iframe')).toHaveAttribute(
      'src',
      `${origin}/watch/embed/video/desktop-share?autostart=0`
    );
    const preview = page.frameLocator('#share-video-preview iframe').locator('video');
    await expect(preview).toBeVisible();
    await expect
      .poll(() => preview.evaluate((video) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await preview.evaluate((video) => video.play());
    await expect.poll(() => preview.evaluate((video) => video.currentTime)).toBeGreaterThan(0);
    assert.equal(await preview.evaluate(() => typeof window.require), 'undefined');
  }
  violations.push(...(await page.evaluate(() => window.shareFrameViolations)));
  assert.deepEqual(violations, []);
  console.log(
    'Electron share modal plays video through HTTP public and HTTPS tunnel embeds; frames remain isolated.'
  );
} finally {
  const closed = application.waitForEvent('close', { timeout: 30_000 });
  await application.evaluate(({ app }) => app.quit());
  await closed;
}
