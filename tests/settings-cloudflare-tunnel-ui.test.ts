import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('places the tunnel toggle after Turnstile and reconciles saves, partial failures, and lost responses', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const html = ejs.render(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
    model: { clientSettings: { isGpuAccelerationSupported: false } },
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let enabled: boolean | undefined;
  let cdn = false;
  let behavior: 'success' | 'partial' | 'reject' | 'lost' | 'busy' | 'reported' = 'success';
  let gate: Promise<void> | undefined;
  let runtimeError = false;
  let runtimeStatus: 'starting' | 'stopped' | undefined;
  let refreshFailure: 'settings' | 'runtime' | undefined;
  let rollbackRejected = false;
  let rateLimited = false;
  let saves = 0;
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/tunnel/toggle')) {
      saves++;
      await gate;
      const requested = (route.request().postDataJSON() as { isEnabled: boolean }).isEnabled;
      if (!requested && rollbackRejected) {
        await route.fulfill({
          status: 500,
          json: { isError: true, isCloudflareTunnelEnabled: enabled },
        });
        return;
      }
      if (behavior !== 'reject' && behavior !== 'busy') {
        enabled = requested;
      }
      runtimeError = behavior === 'partial';
      if (behavior === 'lost') {
        await route.abort('timedout');
        return;
      }
      await route.fulfill({
        status:
          behavior === 'partial'
            ? 502
            : behavior === 'reject'
              ? 500
              : behavior === 'busy'
                ? 409
                : 200,
        json: {
          isError: behavior !== 'success',
          settingsSaved: behavior !== 'reject' && behavior !== 'busy',
          isCloudflareTunnelEnabled: enabled ?? true,
          cloudflareTunnelName: 'SECRET_QUICK_NAME',
          tunnel: {
            mode: 'quick',
            status: runtimeError ? 'error' : 'running',
            name: 'SECRET_QUICK_NAME',
            ...(rateLimited ? { failureReason: 'rate-limited' } : {}),
          },
        },
      });
      return;
    }
    if (pathname === '/settings/node') {
      await route.fulfill({
        status: refreshFailure === 'settings' ? 503 : 200,
        json: {
          ...(enabled === undefined ? {} : { isCloudflareTunnelEnabled: enabled }),
          isCloudflareCdnEnabled: cdn,
          cloudflareTunnelName: 'SECRET_QUICK_NAME',
        },
      });
      return;
    }
    if (pathname === '/settings/node/cloudflare/tunnel') {
      await route.fulfill({
        status: refreshFailure === 'runtime' ? 503 : 200,
        json: {
          isError: false,
          tunnel: {
            mode: enabled === false ? 'none' : cdn ? 'named' : 'quick',
            status:
              runtimeStatus ?? (runtimeError ? 'error' : enabled === false ? 'stopped' : 'running'),
            name: 'SECRET_QUICK_NAME',
            ...(rateLimited ? { failureReason: 'rate-limited' } : {}),
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
  try {
    await page.goto('http://moartube.test/');
    await page.addScriptTag({ path: 'public/javascript/jquery-3.6.4.min.js' });
    await page.addScriptTag({ path: 'public/javascript/settings-cloudflare-tunnel.js' });
    await page.evaluate(
      `window.tunnelAlerts = []; window.linkUpdates = []; window.tunnelUI = new MoarTubeCloudflareTunnelToggle((error, message) => window.tunnelAlerts.push({ error, message }), (settings, tunnel) => window.linkUpdates.push({ settings, tunnel })); window.tunnelUI.load({}); window.tunnelUI.start(); window.tunnelUI.start();`
    );
    const toggle = page.getByRole('switch', { name: 'Cloudflare Tunnels' });
    await browserExpect(toggle).toBeChecked();
    await browserExpect(toggle).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    const turnstile = await page.locator('#cloudflare-turnstile-checkbox').boundingBox();
    const tunnel = await toggle.boundingBox();
    if (!tunnel || !turnstile) {
      throw new Error('Cloudflare controls are not visible');
    }
    expect(tunnel.x).toBeGreaterThan(turnstile.x);
    expect(Math.abs(tunnel.y - turnstile.y)).toBeLessThan(3);
    await mkdir('temp/tunnel-m3/screenshots', { recursive: true });
    await page
      .locator('.settings-security')
      .screenshot({ path: 'temp/tunnel-m3/screenshots/desktop.png' });

    let release!: () => void;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await toggle.click();
    await browserExpect(toggle).toBeDisabled();
    release();
    gate = undefined;
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    expect(saves).toBe(1);
    expect(await page.evaluate('window.linkUpdates.at(-1)')).toMatchObject({
      settings: { isCloudflareTunnelEnabled: false },
      tunnel: { status: 'stopped' },
    });
    expect(await page.evaluate('window.tunnelAlerts')).toEqual([]);
    await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText('');
    await page.evaluate(
      `window.tunnelUI.load({isCloudflareTunnelEnabled: false, isCloudflareCdnEnabled: true});`
    );
    cdn = true;
    await browserExpect(toggle).toBeEnabled();
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).toBeChecked();
    expect(await page.evaluate('window.tunnelAlerts')).toEqual([]);
    await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText('');

    behavior = 'partial';
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText(
      /preference saved, but/i
    );

    behavior = 'reject';
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();

    behavior = 'busy';
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText(
      /another settings change/i
    );
    behavior = 'lost';
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    expect(enabled).toBe(false);
    await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText(
      /could not be enabled/i
    );

    // A partial enable must reset both the visible switch and the persisted preference.
    for (const failure of ['partial', 'reported'] as const) {
      behavior = failure;
      await toggle.click();
      await browserExpect(toggle).toBeEnabled();
      await browserExpect(toggle).not.toBeChecked();
      expect(enabled).toBe(false);
      await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText(
        /could not be enabled/i
      );
    }

    behavior = 'partial';
    rateLimited = true;
    for (const rejected of [false, true]) {
      rollbackRejected = rejected;
      await toggle.click();
      await browserExpect(toggle).toBeEnabled();
      await browserExpect(toggle).not.toBeChecked();
      await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText(/rate-limiting.*HTTP 429/i);
      expect(await page.locator('#cloudflare-tunnels-status').textContent()).not.toContain('SECRET_QUICK_NAME');
    }
    rateLimited = false;
    rollbackRejected = false;
    enabled = false;
    behavior = 'success';
    for (const state of ['starting', 'stopped'] as const) {
      runtimeStatus = state;
      await toggle.click();
      await browserExpect(toggle).toBeEnabled();
      await browserExpect(toggle).not.toBeChecked();
      expect(enabled).toBe(false);
      await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText(
        /could not be enabled/i
      );
    }
    runtimeStatus = undefined;
    for (const failure of ['settings', 'runtime'] as const) {
      refreshFailure = failure;
      await toggle.click();
      await browserExpect(toggle).toBeEnabled();
      await browserExpect(toggle).not.toBeChecked();
      expect(enabled).toBe(false);
      await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText(
        /could not be enabled/i
      );
    }
    refreshFailure = undefined;
    runtimeStatus = 'starting';
    rollbackRejected = true;
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    expect(enabled).toBe(true);
    await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText(
      /saved preference could not be confirmed as off/i
    );
    runtimeStatus = undefined;
    rollbackRejected = false;
    enabled = false;
    const errorsBeforeSuccess = await page.evaluate('window.tunnelAlerts.length');
    expect(await page.evaluate('window.tunnelAlerts.every((alert) => alert.error === true)')).toBe(
      true
    );
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).toBeChecked();
    await browserExpect(page.locator('#cloudflare-tunnels-status')).toHaveText('');
    expect(await page.evaluate('window.tunnelAlerts.length')).toBe(errorsBeforeSuccess);
    expect(await page.locator('body').innerText()).not.toContain('SECRET_QUICK_NAME');
    expect(await page.locator('#cloudflare-tunnels-status').textContent()).not.toContain(
      'SECRET_QUICK_NAME'
    );
    expect(await page.locator('input[placeholder="name"]').count()).toBe(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileTurnstile = await page.locator('#cloudflare-turnstile-checkbox').boundingBox();
    const mobileTunnel = await toggle.boundingBox();
    if (!mobileTunnel || !mobileTurnstile) {
      throw new Error('Mobile Cloudflare controls are not visible');
    }
    expect(mobileTunnel.y).toBeGreaterThan(mobileTurnstile.y);
    await page
      .locator('.settings-security')
      .screenshot({ path: 'temp/tunnel-m3/screenshots/mobile.png' });
    const overflow = await page
      .locator('.settings-security')
      .evaluate(
        (element: { scrollWidth: number; clientWidth: number }) =>
          element.scrollWidth - element.clientWidth
      );
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await browser.close();
  }
}, 30000);
