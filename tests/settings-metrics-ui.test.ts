import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import ejs from 'ejs';
import { expect, it } from 'vitest';

it('shows local and S3 metrics, refreshes, and isolates node failures at desktop and mobile sizes', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const html = ejs.render(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
    model: { clientSettings: { isGpuAccelerationSupported: false } },
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let s3 = false;
  let failed = false;
  let bytes = 1610612736;
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/settings/metrics/')) {
      const node = pathname.endsWith('/node');
      await route.fulfill({
        status: failed && node ? 500 : 200,
        json: {
          isError: failed && node,
          metrics:
            s3 && node
              ? {
                  storageMode: 's3provider',
                  mediaBytes: null,
                  availableBytes: null,
                  totalBytes: null,
                }
              : {
                  storageMode: 'filesystem',
                  mediaBytes: node ? 1024 : bytes,
                  availableBytes: 1073741824,
                  totalBytes: 10737418240,
                },
        },
      });
      return;
    }
    if (pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: html });
      return;
    }
    try {
      await route.fulfill({ path: path.join(process.cwd(), 'public', pathname) });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  const loadMetrics = async (): Promise<void> => {
    await page.addScriptTag({ path: 'public/javascript/jquery-3.6.4.min.js' });
    await page.addScriptTag({ path: 'public/javascript/settings-metrics.js' });
    await page.evaluate('new MoarTubeStorageMetrics().start()');
  };
  try {
    await page.goto('http://moartube.test/');
    await loadMetrics();
    await browserExpect(page.locator('#metrics-client-media')).toHaveText('1.5 GiB');
    expect(await page.locator('#metrics-node-media').textContent()).toBe('1 KiB');
    expect(await page.locator('#metrics-node-elastic').isVisible()).toBe(false);
    expect(await page.locator('#metrics-client-capacity').getAttribute('aria-valuenow')).toBe('90');
    expect(await page.locator('#metrics-client-occupied').getAttribute('style')).toContain('90%');
    const track = await page.locator('#metrics-client-capacity').boundingBox();
    const other = await page.locator('#metrics-client .metrics-other-usage').boundingBox();
    const media = await page.locator('#metrics-client-usage-bar').boundingBox();
    expect((other?.width ?? 0) / (track?.width ?? 1)).toBeCloseTo(0.75, 2);
    expect((media?.width ?? 0) / (track?.width ?? 1)).toBeCloseTo(0.15, 2);
    expect(media?.x).toBeCloseTo((other?.x ?? 0) + (other?.width ?? 0), 1);
    expect(await page.locator('#metrics-node-capacity').isVisible()).toBe(true);
    expect((await page.locator('#metrics-node-usage-bar').boundingBox())?.width).toBeGreaterThanOrEqual(3);
    bytes = 0;
    s3 = true;
    await page.reload();
    await loadMetrics();
    await browserExpect(page.locator('#metrics-client-media')).toHaveText('0 B');
    expect(await page.locator('#metrics-node-elastic').isVisible()).toBe(true);
    expect(await page.locator('#metrics-node-local').isVisible()).toBe(false);
    expect(await page.locator('#metrics-node-storage').textContent()).toBe('S3 object storage');
    expect(await page.locator('#metrics-client-capacity').getAttribute('aria-valuenow')).toBe('90');
    expect(await page.locator('#metrics-node-capacity').isVisible()).toBe(true);
    expect(await page.locator('#metrics-node-capacity').getAttribute('aria-valuenow')).toBeNull();
    expect(await page.locator('#metrics-node-usage-bar').getAttribute('style')).toContain('0%');
    for (const width of [1280, 600]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')
      ).toBe(true);
    }
    s3 = false;
    failed = true;
    await page.reload();
    await loadMetrics();
    await browserExpect(page.locator('#metrics-node-status')).toContainText('Unable to load');
    expect(await page.locator('#metrics-client-media').textContent()).toBe('0 B');
    expect(await page.locator('#metrics-node-elastic').isVisible()).toBe(false);
    expect(await page.locator('#metrics-node-capacity').isVisible()).toBe(false);
  } finally {
    await browser.close();
  }
}, 20000);
