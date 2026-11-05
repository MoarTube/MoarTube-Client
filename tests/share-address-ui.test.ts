import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('shares through either node address, refreshes tunnels, and preserves external media URLs', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let mode = 'quick';
  let status = 'running';
  let tunnelUrl = 'https://first.trycloudflare.com';
  let publicHost = 'localhost';
  let failTunnel = false;
  let failSettings = false;
  let failSources = false;
  let tunnelEnabled: boolean | undefined;
  let cdnEnabled = false;
  await page.route('**/*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/settings/node/cloudflare/tunnel') {
      await route.fulfill({
        status: failTunnel ? 503 : 200,
        json: { tunnel: { mode, status, publicUrl: tunnelUrl } },
      });
    } else if (pathname === '/settings/node') {
      await route.fulfill({
        status: failSettings ? 503 : 200,
        json: {
          isCloudflareTunnelEnabled: tunnelEnabled,
          isCloudflareCdnEnabled: cdnEnabled,
          publicNodeProtocol: publicHost === 'localhost' ? 'http' : 'https',
          publicNodeAddress: publicHost,
          publicNodePort: publicHost === 'localhost' ? 3000 : 443,
        },
      });
    } else if (pathname.endsWith('/sources')) {
      await route.fulfill({
        status: failSources ? 503 : 200,
        json: {
          sources: {
            adaptiveSources: [
              { src: 'http://localhost:3000/external/videos/video123/manifest.m3u8' },
            ],
            progressiveSources: [{ src: 'https://storage.test/bucket/video.mp4?token=keep' }],
          },
        },
      });
    } else {
      await route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
    }
  });
  const template = await readFile('public/views/videos.ejs', 'utf8');
  const start = template.indexOf('class MoarTubeClientVideos');
  const end = template.indexOf('const moarTubeClientVideos', start);
  try {
    await page.goto('http://moartube.test/');
    await page.addStyleTag({
      content: await readFile('public/css/soft-ui-dashboard-1.1.0.min.css', 'utf8'),
    });
    await page.addStyleTag({ content: template.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '' });
    for (const script of [
      'jquery-3.6.4.min.js',
      'popper-2.11.6.min.js',
      'bootstrap-5.2.2.min.js',
      'sweetalert-11.0.11.min.js',
      'public-node-url.js',
      'share-address.js',
    ]) {
      await page.addScriptTag({ content: await readFile(`public/javascript/${script}`, 'utf8') });
    }
    await page.addScriptTag({
      content: `
      const INCOMING_PARAMETERS = {};
      ${template.slice(start, end)}
      window.client = new MoarTubeClientVideos();
      client.NODE_BASE_URL = 'http://localhost:3000';
      client.setClipboard = (value) => { window.copied = value; };
      window.Pickr = { create() { return { on() { return this; } }; } };
    `,
    });
    const open = (): Promise<void> => page.evaluate("client.showShareModal('video123')");
    const close = (): Promise<void> => page.evaluate('Swal.close()');
    const link = page.locator('#node-video-url-input');
    const selector = page.getByLabel('Share using');
    await open();
    await browserExpect(link).toHaveValue(tunnelUrl + '/watch?v=video123');
    await browserExpect(page.locator('#share-address-status')).toBeHidden();
    await browserExpect(page.locator('#share-video-preview iframe')).toHaveAttribute(
      'src',
      tunnelUrl + '/watch/embed/video/video123?autostart=0'
    );
    await browserExpect(page.locator('#direct-source-links-select')).toHaveValue(
      tunnelUrl + '/external/videos/video123/manifest.m3u8'
    );
    await page.locator('#video-embed-code-copy-button').click();
    expect(await page.evaluate('window.copied')).toContain(tunnelUrl + '/watch/embed/video/');
    await browserExpect(page.locator('#video-embed-code-copy-button')).toHaveText('copy');
    await browserExpect(page.getByRole('tooltip')).toHaveText('copied!');
    await browserExpect(page.getByRole('tooltip')).toHaveCount(0);
    await page
      .locator('#direct-source-links-select')
      .selectOption('https://storage.test/bucket/video.mp4?token=keep');
    await selector.selectOption('public');
    await browserExpect(link).toHaveValue('http://localhost:3000/watch?v=video123');
    await browserExpect(page.locator('#direct-source-links-select')).toHaveValue(
      'https://storage.test/bucket/video.mp4?token=keep'
    );
    await close();
    await open();
    await browserExpect(selector).toHaveValue('tunnel');
    await selector.selectOption('tunnel');
    await close();
    tunnelUrl = 'https://new.trycloudflare.com';
    await open();
    await browserExpect(link).toHaveValue(tunnelUrl + '/watch?v=video123');
    await page.evaluate(
      "Promise.all(document.querySelector('.swal2-popup').getAnimations().map((animation) => animation.finished))"
    );
    await page.screenshot({ path: path.join(tmpdir(), 'moartube-share-modal.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const popup = await page.locator('.swal2-popup').boundingBox();
    expect(popup?.x).toBeGreaterThanOrEqual(0);
    expect((popup?.x ?? 0) + (popup?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(
      await page
        .locator('.swal2-html-container')
        .evaluate(
          (element: { scrollWidth: number; clientWidth: number }) =>
            element.scrollWidth <= element.clientWidth
        )
    ).toBe(true);
    await page.screenshot({ path: path.join(tmpdir(), 'moartube-share-modal-mobile.png') });
    await page.setViewportSize({ width: 1100, height: 1000 });
    await close();

    await page.evaluate("client.showChatEmbedModal('video123')");
    await browserExpect(page.locator('#embed-chat-input')).toHaveValue(
      tunnelUrl + '/watch/embed/chat/video123?sci=false&bgc=000000&ctc=F9F9F9'
    );
    await page.locator('#embed-chat-show-chat-checkbox').check();
    await selector.selectOption('public');
    await browserExpect(page.locator('#embed-chat-input')).toHaveValue(
      'http://localhost:3000/watch/embed/chat/video123?sci=true&bgc=000000&ctc=F9F9F9'
    );
    await close();

    // CDN off defaults to the available tunnel, regardless of the tunnel mode.
    mode = 'named';
    publicHost = 'domain.test';
    tunnelUrl = 'https://tunnel.domain.test';
    await open();
    await browserExpect(selector).toHaveValue('tunnel');
    await browserExpect(link).toHaveValue(tunnelUrl + '/watch?v=video123');
    await close();

    // CDN sharing always uses the public URL and omits the address chooser.
    cdnEnabled = true;
    await open();
    await browserExpect(link).toHaveValue('https://domain.test/watch?v=video123');
    await browserExpect(selector).toBeHidden();
    await browserExpect(page.locator('label[for="share-address-select"]')).toBeHidden();
    await browserExpect(page.locator('#video-embed-url-input')).toHaveValue(
      'https://domain.test/watch/embed/video/video123?autostart=0'
    );
    await browserExpect(page.locator('#video-embed-code-input')).toHaveValue(
      /src="https:\/\/domain\.test\/watch\/embed\/video\//
    );
    await browserExpect(page.locator('#share-video-preview iframe')).toHaveAttribute(
      'src',
      'https://domain.test/watch/embed/video/video123?autostart=0'
    );
    await browserExpect(page.locator('#direct-source-links-select')).toHaveValue(
      'https://domain.test/external/videos/video123/manifest.m3u8'
    );
    await close();
    await page.evaluate("client.showChatEmbedModal('video123')");
    await browserExpect(page.locator('#embed-chat-input')).toHaveValue(
      'https://domain.test/watch/embed/chat/video123?sci=false&bgc=000000&ctc=F9F9F9'
    );
    await browserExpect(selector).toBeHidden();
    await close();

    // An invalid public address cannot silently switch CDN sharing onto the tunnel.
    publicHost = '';
    await open();
    await browserExpect(page.locator('#share-address-status')).toContainText('No share address');
    await browserExpect(selector).toBeHidden();
    await browserExpect(page.locator('#node-video-url-copy-button')).toBeDisabled();
    await close();
    publicHost = 'domain.test';
    cdnEnabled = false;

    // A disabled preference overrides a stale running state and a remembered tunnel selection.
    tunnelEnabled = false;
    for (const tunnelMode of ['quick', 'named']) {
      mode = tunnelMode;
      await open();
      await browserExpect(selector.locator('option[value="tunnel"]')).toBeDisabled();
      await browserExpect(selector.locator('option[value="tunnel"]')).toContainText('disabled');
      await browserExpect(link).toHaveValue('https://domain.test/watch?v=video123');
      await page.evaluate(
        "Promise.all(document.querySelector('.swal2-popup').getAnimations().map((animation) => animation.finished))"
      );
      await browserExpect
        .poll(async () => (await page.locator('.swal2-popup').boundingBox())?.width ?? 0)
        .toBeGreaterThan(700);
      await page.screenshot({ path: path.join(tmpdir(), 'moartube-share-disabled-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobilePopup = await page.locator('.swal2-popup').boundingBox();
      expect(mobilePopup?.x).toBeGreaterThanOrEqual(0);
      expect((mobilePopup?.x ?? 0) + (mobilePopup?.width ?? 0)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(tmpdir(), 'moartube-share-disabled-mobile.png') });
      await page.setViewportSize({ width: 1100, height: 1000 });
      await close();
    }
    tunnelEnabled = true;
    await open();
    await browserExpect(selector).toHaveValue('tunnel');
    await browserExpect(link).toHaveValue(tunnelUrl + '/watch?v=video123');
    await close();

    // Without settings, the enabled preference cannot be confirmed.
    failSettings = true;
    await open();
    await browserExpect(selector.locator('option[value="tunnel"]')).toBeDisabled();
    await browserExpect(page.locator('#node-video-url-copy-button')).toBeDisabled();
    await close();
    failSettings = false;

    tunnelUrl = 'https://domain.test';
    await open();
    await browserExpect(selector.locator('option')).toHaveCount(1);
    await browserExpect(selector).toBeDisabled();
    await browserExpect(link).toHaveValue('https://domain.test/watch?v=video123');
    await close();

    for (const state of ['starting', 'stopped', 'error']) {
      status = state;
      await open();
      await browserExpect(selector.locator('option[value="tunnel"]')).toBeDisabled();
      await browserExpect(link).toHaveValue('https://domain.test/watch?v=video123');
      await close();
    }
    failTunnel = true;
    failSources = true;
    await open();
    await browserExpect(link).toHaveValue('https://domain.test/watch?v=video123');
    await browserExpect(page.locator('#share-sources-status')).toHaveText(
      'Media links could not be loaded.'
    );
    await browserExpect(page.locator('#node-video-url-copy-button')).toBeEnabled();
    await close();
    failSettings = true;
    await open();
    await browserExpect(page.locator('#share-address-status')).toContainText('No share address');
    await browserExpect(page.locator('#node-video-url-copy-button')).toBeDisabled();
    await browserExpect(link).toHaveValue('');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
