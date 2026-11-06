import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';
import ejs from 'ejs';

it('truncates node addresses and respects CDN and tunnel availability', async () => {
  const template = await readFile('public/views/videos.ejs', 'utf8');
  const html = template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const settings = {
    publicNodeProtocol: 'https',
    publicNodeAddress: 'a-very-long-public-node-domain.example.test',
    publicNodePort: 443,
    isCloudflareCdnEnabled: false,
    isCloudflareTunnelEnabled: true,
  };
  const tunnel = {
    mode: 'quick',
    status: 'running',
    publicUrl: 'https://a-very-long-quick-tunnel-hostname.trycloudflare.com',
  };
  let failSettings = false;
  let failTunnel = false;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'moartube.test') {
      await route.fulfill({ contentType: 'text/html', body: '<h1>Node home page</h1>' });
    } else if (url.pathname === '/settings/node') {
      await route.fulfill({ status: failSettings ? 503 : 200, json: settings });
    } else if (url.pathname === '/settings/node/cloudflare/tunnel') {
      await route.fulfill({ status: failTunnel ? 503 : 200, json: { isError: false, tunnel } });
    } else if (url.pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: html });
    } else {
      try {
        await route.fulfill({
          path: path.join(process.cwd(), 'public', decodeURIComponent(url.pathname)),
        });
      } catch {
        await route.fulfill({ status: 404, body: '' });
      }
    }
  });
  try {
    await page.goto('http://moartube.test/');
    for (const script of ['jquery-3.6.4.min.js', 'public-node-url.js', 'node-visit-links.js']) {
      await page.addScriptTag({ content: await readFile(`public/javascript/${script}`, 'utf8') });
    }
    await page.evaluate(
      `MoarTubeNodeVisitLinks.load(${JSON.stringify(settings)}); window.visits = MoarTubeNodeVisitLinks.current;`
    );
    const publicLink = page.locator('[data-node-public-link]');
    const tunnelLink = page.locator('[data-node-tunnel-link]');
    await browserExpect(publicLink).toHaveAttribute(
      'href',
      'https://' + settings.publicNodeAddress + '/'
    );
    await browserExpect(tunnelLink).toHaveAttribute('href', tunnel.publicUrl + '/');
    await browserExpect(tunnelLink).toHaveAttribute('title', tunnel.publicUrl + '/');
    await browserExpect(tunnelLink).toHaveAttribute('target', '_blank');
    expect(await page.locator('#sidenav-main hr').count()).toBe(3);
    expect(
      await tunnelLink
        .locator('.node-visit-address')
        .evaluate(
          (element: { scrollWidth: number; clientWidth: number }) =>
            element.scrollWidth > element.clientWidth
        )
    ).toBe(true);
    await page
      .locator('#sidenav-main')
      .screenshot({ path: path.join(tmpdir(), 'moartube-node-visits-desktop.png') });
    const [popup] = await Promise.all([page.waitForEvent('popup'), publicLink.click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://' + settings.publicNodeAddress + '/');
    await popup.close();

    settings.isCloudflareCdnEnabled = true;
    await page.evaluate('visits.refresh()');
    await browserExpect(tunnelLink).toBeHidden();
    await browserExpect(publicLink).toHaveAttribute(
      'href',
      'https://' + settings.publicNodeAddress + '/'
    );

    settings.isCloudflareCdnEnabled = false;
    settings.isCloudflareTunnelEnabled = false;
    await page.evaluate('visits.refresh()');
    await browserExpect(tunnelLink).toBeVisible();
    await browserExpect(tunnelLink).not.toHaveAttribute('href');
    await browserExpect(tunnelLink).toContainText('Disabled');
    settings.isCloudflareTunnelEnabled = true;
    tunnel.status = 'starting';
    await page.evaluate('visits.refresh()');
    await browserExpect(tunnelLink).toContainText('Starting');
    await browserExpect(tunnelLink).not.toHaveAttribute('href');

    tunnel.status = 'running';
    await page.evaluate('visits.refresh()');
    await browserExpect(tunnelLink).toHaveAttribute('href', tunnel.publicUrl + '/');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate("document.body.classList.add('g-sidenav-pinned')");
    await page
      .locator('#sidenav-main')
      .screenshot({ path: path.join(tmpdir(), 'moartube-node-visits-mobile.png') });
    const bounds = await page.locator('#sidenav-main').boundingBox();
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);

    failTunnel = true;
    await page.evaluate('visits.refresh()');
    await browserExpect(tunnelLink).toContainText('Unavailable');
    await browserExpect(tunnelLink).not.toHaveAttribute('href');
    failSettings = true;
    await page.evaluate('visits.refresh()');
    await browserExpect(publicLink).not.toHaveAttribute('href');
    await page.evaluate('visits.stop()');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);

it.each([
  'videos',
  'comments',
  'links',
  'monetization',
  'reports-comments',
  'reports-videos',
  'settings',
])(
  'loads the third sidebar group on %s and leaves branding non-clickable',
  async (view) => {
    const template = await readFile(`public/views/${view}.ejs`, 'utf8');
    const html = ejs.render(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
      model: { clientSettings: { isGpuAccelerationSupported: false } },
    });
    const settings = {
      publicNodeProtocol: 'https',
      publicNodeAddress: 'node.test',
      publicNodePort: 443,
      isCloudflareCdnEnabled: false,
      isCloudflareTunnelEnabled: true,
      databaseConfig: { databaseDialect: 'sqlite' },
      storageConfig: { storageMode: 'filesystem' },
    };
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/settings/node') {
        await route.fulfill({ json: settings });
      } else if (pathname === '/settings/node/cloudflare/tunnel') {
        await route.fulfill({
          json: {
            tunnel: {
              mode: 'quick',
              status: 'running',
              publicUrl: 'https://quick.trycloudflare.com',
            },
          },
        });
      } else if (pathname === '/') {
        await route.fulfill({ contentType: 'text/html', body: html });
      } else {
        try {
          await route.fulfill({
            path: path.join(process.cwd(), 'public', decodeURIComponent(pathname)),
          });
        } catch {
          await route.fulfill({ status: 404, body: '' });
        }
      }
    });
    try {
      await page.goto('http://moartube.test/');
      for (const script of ['jquery-3.6.4.min.js', 'public-node-url.js', 'node-visit-links.js']) {
        await page.addScriptTag({ content: await readFile(`public/javascript/${script}`, 'utf8') });
      }
      const className = /class (MoarTubeClient\w+)/.exec(template)?.[1];
      if (className === undefined) {
        throw new Error('Page controller missing');
      }
      const start = template.indexOf('class ' + className);
      const end = template.indexOf('const moarTubeClient', start);
      await page.addScriptTag({
        content: `
        const INCOMING_PARAMETERS = {};
        ${template.slice(start, end)}
        window.auditPage = Object.create(${className}.prototype);
        auditPage.nodeBulletin = { load() {} };
        auditPage.nodeNeighbors = { load() {} };
        auditPage.cloudflareCdn = { load() {} };
        auditPage.cloudflareTunnelToggle = { load() {} };
        auditPage.loadNodeSettings(${JSON.stringify(settings)});
      `,
      });
      await browserExpect(page.locator('[data-node-public-link]')).toHaveAttribute(
        'href',
        'https://node.test/'
      );
      await browserExpect(page.locator('[data-node-tunnel-link]')).toHaveAttribute(
        'href',
        'https://quick.trycloudflare.com/'
      );
      await browserExpect(page.locator('#node-link')).toHaveJSProperty('tagName', 'DIV');
      await browserExpect(page.locator('#node-link')).not.toHaveAttribute('href');
      await browserExpect(
        page.locator('#sidenav-collapse-main > ul > li:last-child [data-node-visit-links]')
      ).toBeVisible();
      expect(await page.locator('#sidenav-main hr').count()).toBe(3);
      expect(await page.locator('[data-node-visit-links] h6').count()).toBe(0);
      settings.isCloudflareCdnEnabled = true;
      await page.evaluate(`auditPage.loadNodeSettings(${JSON.stringify(settings)})`);
      await browserExpect(page.locator('[data-node-tunnel-link]')).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  30000
);
