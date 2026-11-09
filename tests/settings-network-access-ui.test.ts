import { readFile, mkdir } from 'node:fs/promises';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('places the independent toggles correctly, saves choices and rolls back failed saves', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  let reject = false;
  const writes: { target: string; enabled: boolean }[] = [];
  const html = ejs.render(template, {
    bundledDesktop: false, bundledAutoLogin: false,
    model: { clientSettings: {}, nodeSettings: {} },
  });
  await page.route('http://moartube.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/network/access')) {
      writes.push({ target: pathname.split('/')[2], enabled: route.request().postDataJSON().allowRemoteConnections });
      await route.fulfill({ status: reject ? 500 : 200, json: reject
        ? { isError: true, message: 'Settings could not be saved.' }
        : { isError: false, restartRequired: true } });
    } else if (pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') });
    } else {
      try { await route.fulfill({ body: await readFile('public' + pathname), contentType: pathname.endsWith('.css') ? 'text/css' : 'text/plain' }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    }
  });
  try {
    await page.goto('http://moartube.test/');
    await page.addScriptTag({ path: 'public/javascript/jquery-3.6.4.min.js' });
    const start = html.indexOf('class MoarTubeClientSettings');
    const end = html.indexOf('const moarTubeClientSettings = new', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    await page.addScriptTag({ content: html.slice(start, end) });
    await page.evaluate(`window.networkUI = Object.create(MoarTubeClientSettings.prototype);
      $('.toggle-network-access').on('change', function () { window.networkUI.toggleNetworkAccess(this); });`);
    await browserExpect(page.locator('#client-network-access-status, #node-network-access-status')).toHaveCount(0);
    const client = page.locator('#client-allow-remote-connections');
    const node = page.locator('#node-allow-remote-connections');
    await browserExpect(page.locator('[aria-label="Client settings"] .toggle-network-access')).toHaveCount(1);
    expect(await client.evaluate(el => !el.closest('.card-body')?.parentElement?.nextElementSibling)).toBe(true);
    const secureBox = await page.locator('#node-setting-secure-mode-checkbox').boundingBox();
    const nodeBox = await node.boundingBox();
    const cdnBox = await page.locator('#cloudflare-one-click-cdn-checkbox').boundingBox();
    expect(secureBox!.x).toBeLessThan(nodeBox!.x);
    expect(nodeBox!.x).toBeLessThan(cdnBox!.x);
    expect(Math.abs(secureBox!.y - nodeBox!.y)).toBeLessThan(2);
    await client.check();
    await browserExpect(client).toBeEnabled();
    await browserExpect(node).not.toBeChecked();
    await node.check();
    await browserExpect(node).toBeEnabled();
    expect(writes).toEqual([{ target: 'client', enabled: true }, { target: 'node', enabled: true }]);
    reject = true;
    await node.uncheck();
    await browserExpect(node).toBeChecked();
    await browserExpect(node).toBeEnabled();
    await mkdir('build/test/network-access-ui', { recursive: true });
    await page.locator('[aria-label="Client settings"]').screenshot({ path: 'build/test/network-access-ui/client.png' });
    await page.locator('.settings-security').screenshot({ path: 'build/test/network-access-ui/node.png' });
    await page.setViewportSize({ width: 390, height: 1000 });
    // The full page's sidebar controller is omitted from this isolated form test.
    await page.addStyleTag({ content: '.main-content { margin-left: 0 !important; width: 100% !important; transition: none !important; }' });
    const overflow = await page.locator('.settings-security').evaluate(el => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await browser.close();
  }
}, 30000);
