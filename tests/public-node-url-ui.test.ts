import { readFile } from 'node:fs/promises';
import { chromium, expect as browserExpect } from '@playwright/test';
import { it } from 'vitest';

it('refreshes the Settings link and form from persisted values after success and rejected saves', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
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
        body: '<a id="node-link"></a><form id="network" action="/settings/node/network/external"><select name="publicNodeProtocol" id="public-node-protocol-select"><option value="https">HTTPS</option></select><input name="publicNodeAddress" id="public-node-address-input"><input name="publicNodePort" id="public-node-port-input"></form>',
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
    await page.addScriptTag({
      content: `const INCOMING_PARAMETERS = {}; window.Swal = { showLoading() {}, fire(options) { if (options.didOpen) options.didOpen(); else window.lastAlert = options; } }; ${template.slice(start, end)} window.auditSettings = new MoarTubeClientSettings();`,
    });
    await page.evaluate(`auditSettings.loadNodeSettings(${JSON.stringify(settings)})`);
    await browserExpect(page.locator('#node-link')).toHaveAttribute('href', 'https://old.test');
    await page.evaluate("auditSettings.handleExternalNetworkSettingsForm($('#network'))");
    await browserExpect(page.locator('#node-link')).toHaveAttribute(
      'href',
      'https://[2001:db8::1]:8443'
    );
    for (status of [200, 400]) {
      rejected = true;
      await page.locator('#public-node-address-input').fill('rejected.test');
      await page.evaluate("auditSettings.handleExternalNetworkSettingsForm($('#network'))");
      await browserExpect(page.locator('#public-node-address-input')).toHaveValue('2001:db8::1');
      await browserExpect(page.locator('#node-link')).toHaveAttribute(
        'href',
        'https://[2001:db8::1]:8443'
      );
      await browserExpect
        .poll(() => page.evaluate('window.lastAlert.text'))
        .toBe('Change rejected');
    }
  } finally {
    await browser.close();
  }
});
