import ejs from 'ejs';
import { readFile } from 'node:fs/promises';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('refreshes the Settings sidebar link and form from persisted values after success and rejected saves', async () => {
  const template = ejs.render(await readFile('public/views/settings.ejs', 'utf8'), { bundledDesktop: false, model: { clientSettings: {} } });
  const start = template.indexOf('class MoarTubeClientSettings');
  const end = template.indexOf('const moarTubeClientSettings', start);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let rejected = false;
  let status = 200;
  const settings = {
    publicNodeProtocol: 'https',
    publicNodeAddress: 'old.test',
    publicNodePort: 443,
    databaseConfig: { databaseDialect: 'sqlite' },
    storageConfig: { storageMode: 'filesystem' },
  };
  await page.route('http://moartube.test/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      if (!rejected) {
        Object.assign(settings, { publicNodeAddress: '2001:db8::1', publicNodePort: 8443 });
      }
      await route.fulfill({
        status,
        json: { isError: rejected, message: rejected ? 'Change rejected' : undefined },
      });
    } else if (new URL(request.url()).pathname === '/settings/node') {
      await route.fulfill({ json: settings });
    } else {
      await route.fulfill({
        contentType: 'text/html',
        body: '<div id="node-link"></div><section data-node-visit-links></section><form id="network" action="/settings/node/network/external"><select name="publicNodeProtocol" id="public-node-protocol-select"><option value="https">HTTPS</option><option value="http">HTTP</option></select><input name="publicNodeAddress" id="public-node-address-input"><input name="publicNodePort" id="public-node-port-input"></form>',
      });
    }
  });
  try {
    await page.goto('http://moartube.test/');
    await page.addScriptTag({
      content: await readFile('public/javascript/jquery-3.6.4.min.js', 'utf8'),
    });
    await page.addScriptTag({
      content: await readFile('public/javascript/public-node-url.js', 'utf8'),
    });
    for (const script of [
      'settings-cloudflare-tunnel.js',
      'settings-cloudflare-cdn.js',
      'node-visit-links.js',
    ]) {
      await page.addScriptTag({ content: await readFile(`public/javascript/${script}`, 'utf8') });
    }
    await page.addScriptTag({
      content: `const INCOMING_PARAMETERS = {}; class MoarTubeNodeBulletin { load() {} } class MoarTubeNodeLinks { load() {} } class MoarTubeNodeIcons { load() {} } class MoarTubeNodeMonetization { load() {} } window.Swal = { showLoading() {}, fire(options) { if (options.didOpen) options.didOpen(); else window.lastAlert = options; } }; ${template.slice(start, end)} window.auditSettings = new MoarTubeClientSettings();`,
    });
    await page.evaluate(`auditSettings.loadNodeSettings(${JSON.stringify(settings)})`);
    await browserExpect(page.locator('[data-node-public-link]')).toHaveAttribute(
      'href',
      'https://old.test/'
    );
    await page.evaluate("auditSettings.handleExternalNetworkSettingsForm($('#network'))");
    await browserExpect(page.locator('[data-node-public-link]')).toHaveAttribute(
      'href',
      'https://[2001:db8::1]:8443/'
    );
    for (status of [200, 400]) {
      rejected = true;
      await page.locator('#public-node-address-input').fill('rejected.test');
      await page.evaluate("auditSettings.handleExternalNetworkSettingsForm($('#network'))");
      await browserExpect(page.locator('#public-node-address-input')).toHaveValue('2001:db8::1');
      await browserExpect(page.locator('[data-node-public-link]')).toHaveAttribute(
        'href',
        'https://[2001:db8::1]:8443/'
      );
      await browserExpect
        .poll(() => page.evaluate('window.lastAlert.text'))
        .toBe('Change rejected');
    }
    for (const address of [
      {
        publicNodeProtocol: 'https',
        publicNodeAddress: 'example.com',
        publicNodePort: 443,
        isCloudflareCdnEnabled: true,
      },
      {
        publicNodeProtocol: 'http',
        publicNodeAddress: 'localhost',
        publicNodePort: 9090,
        isCloudflareCdnEnabled: false,
      },
    ]) {
      Object.assign(settings, address);
      await page.evaluate(
        `auditSettings.cloudflareCdn.onSettingsChanged(${JSON.stringify(settings)})`
      );
      await browserExpect(page.locator('#public-node-protocol-select')).toHaveValue(
        address.publicNodeProtocol
      );
      await browserExpect(page.locator('#public-node-address-input')).toHaveValue(
        address.publicNodeAddress
      );
      await browserExpect(page.locator('#public-node-port-input')).toHaveValue(
        String(address.publicNodePort)
      );
      expect(await page.evaluate("localStorage.getItem('moartube-public-node-url-change')")).toBe(
        JSON.stringify([
          address.publicNodeProtocol,
          address.publicNodeAddress,
          address.publicNodePort,
        ])
      );
    }
  } finally {
    await browser.close();
  }
});
