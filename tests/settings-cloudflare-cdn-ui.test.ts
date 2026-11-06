import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('requests only CDN credentials, preserves tunnel preference, and refreshes partial CDN changes', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const html = ejs.render(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
    model: { clientSettings: { isGpuAccelerationSupported: false } },
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let cdn = false;
  let migrationPending = false;
  let releaseRetry: (() => void) | undefined;
  let waitForRetry: Promise<void> | undefined;
  let behavior: 'success' | 'partial' | 'reject' | 'lost' | 'busy' = 'success';
  let writes = 0;
  const requests: object[] = [];
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      pathname === '/settings/node/cloudflare/configure' ||
      pathname === '/settings/node/cloudflare/clear' ||
      pathname === '/settings/node/cloudflare/retry'
    ) {
      writes++;
      requests.push(route.request().postDataJSON() as object);
      if (pathname.endsWith('/retry')) {
        await waitForRetry;
      }
      if (behavior !== 'reject' && behavior !== 'busy') {
        if (!pathname.endsWith('/retry')) {
          cdn = pathname.endsWith('/configure');
        }
        migrationPending = behavior === 'partial' || behavior === 'lost';
      }
      if (behavior === 'lost') {
        await route.abort('timedout');
        return;
      }
      await route.fulfill({
        status:
          behavior === 'partial'
            ? 502
            : behavior === 'reject'
              ? 400
              : behavior === 'busy'
                ? 409
                : 200,
        json: {
          isError: behavior !== 'success',
          settingsSaved: behavior !== 'reject' && behavior !== 'busy',
          cloudflareAddressMigrationPending: migrationPending,
          cdnTransition: {
            id: 'transition',
            targetEnabled: cdn,
            stage: migrationPending ? 'purge' : 'complete',
          },
          isCloudflareCdnEnabled: cdn,
          isCloudflareTunnelEnabled: false,
          cloudflareTunnelName: 'SECRET_QUICK_NAME',
          tunnel: { mode: 'none', status: 'stopped', name: '' },
        },
      });
      return;
    }
    if (pathname === '/settings/node') {
      await route.fulfill({
        json: {
          isCloudflareCdnEnabled: cdn,
          cloudflareAddressMigrationPending: migrationPending,
          cdnTransition: {
            id: 'transition',
            targetEnabled: cdn,
            stage: migrationPending ? 'purge' : 'complete',
          },
          publicNodeProtocol: cdn ? 'https' : 'http',
          publicNodeAddress: cdn ? 'example.com' : 'localhost',
          publicNodePort: cdn ? 443 : 9090,
          isCloudflareTunnelEnabled: false,
          cloudflareTunnelName: 'SECRET_QUICK_NAME',
        },
      });
      return;
    }
    if (pathname === '/settings/node/cloudflare/tunnel') {
      await route.fulfill({
        json: { isError: false, tunnel: { mode: 'none', status: 'stopped', name: '' } },
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
    const initialize = async (): Promise<void> => {
      for (const script of [
        'jquery-3.6.4.min.js',
        'sweetalert-11.0.11.min.js',
        'settings-cloudflare-tunnel.js',
        'settings-cloudflare-cdn.js',
      ]) {
        await page.addScriptTag({ path: 'public/javascript/' + script });
      }
      await page.evaluate(
        `window.cdnAlerts=[]; window.reconciledSettings=[]; window.tunnelUI=new MoarTubeCloudflareTunnelToggle(()=>{}); window.tunnelUI.load({isCloudflareTunnelEnabled:false}); window.cdnUI=new MoarTubeCloudflareCdn((error,message)=>window.cdnAlerts.push({error,message}),window.tunnelUI,(settings)=>window.reconciledSettings.push(settings)); window.cdnUI.load({isCloudflareCdnEnabled:false}); $('#cloudflare-one-click-cdn-checkbox').on('change',()=>void window.cdnUI.toggle());`
      );
    };
    await initialize();
    const toggle = page.locator('#cloudflare-one-click-cdn-checkbox');
    await toggle.click();
    await page.getByRole('button', { name: 'Close this dialog' }).click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    expect(writes).toBe(0);
    const openForm = async (): Promise<void> => {
      await toggle.click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    };
    const fillForm = async (): Promise<void> => {
      await page.getByLabel('Cloudflare Email Address', { exact: true }).fill('email@example.com');
      await page.getByLabel('Cloudflare Zone ID', { exact: true }).fill('zone');
      await page.getByLabel('Cloudflare Global API Key', { exact: true }).fill('key');
    };
    await openForm();
    await browserExpect(page.getByLabel('Cloudflare Tunnel Name', { exact: true })).toHaveCount(0);
    await browserExpect(page.locator('.swal2-popup .text-start input')).toHaveCount(3);
    await page.getByRole('button', { name: 'Close this dialog' }).click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    expect(writes).toBe(0);
    await openForm();
    await page.getByLabel('Cloudflare Email Address', { exact: true }).fill('   ');
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await browserExpect(page.locator('.swal2-validation-message')).toBeVisible();
    expect(writes).toBe(0);
    await fillForm();
    await mkdir('temp/tunnel-m4/screenshots', { recursive: true });
    await page
      .locator('.swal2-popup')
      .screenshot({ path: 'temp/tunnel-m4/screenshots/cdn-modal.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const modal = await page.locator('.swal2-popup').boundingBox();
    if (!modal) {
      throw new Error('CDN modal is not visible on mobile');
    }
    await page
      .locator('.swal2-popup')
      .screenshot({ path: 'temp/tunnel-m4/screenshots/cdn-modal-mobile.png' });
    const layout = await page.evaluate(
      'JSON.stringify({viewport:innerWidth,inline:document.querySelector(".swal2-popup").style.cssText,width:getComputedStyle(document.querySelector(".swal2-popup")).width,min:getComputedStyle(document.querySelector(".swal2-popup")).minWidth,max:getComputedStyle(document.querySelector(".swal2-popup")).maxWidth})'
    );
    expect(modal.width, layout).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).toBeChecked();
    expect(requests[0]).toEqual({
      cloudflareEmailAddress: 'email@example.com',
      cloudflareZoneId: 'zone',
      cloudflareGlobalApiKey: 'key',
    });
    await browserExpect(page.getByRole('switch', { name: 'Cloudflare Tunnels' })).not.toBeChecked();
    expect(await page.evaluate('window.reconciledSettings.at(-1)')).toMatchObject({
      publicNodeProtocol: 'https',
      publicNodeAddress: 'example.com',
      publicNodePort: 443,
    });
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    expect(await page.evaluate('window.reconciledSettings.at(-1)')).toMatchObject({
      publicNodeProtocol: 'http',
      publicNodeAddress: 'localhost',
      publicNodePort: 9090,
    });
    behavior = 'partial';
    await openForm();
    await fillForm();
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await page.waitForFunction('window.cdnUI.pending === false');
    await browserExpect(toggle).toBeDisabled();
    await browserExpect(toggle).toBeChecked();
    expect(await page.evaluate('window.cdnAlerts.at(-1).message')).toMatch(/settings saved, but/i);
    const recovery = page.locator('#cloudflare-cdn-recovery');
    await browserExpect(recovery).toBeVisible();
    await browserExpect(recovery).toContainText('CDN setup incomplete');
    // A real refresh reconstructs the panel from the persisted Node settings.
    await page.reload();
    await initialize();
    await page.evaluate(
      "$.getJSON('/settings/node').then(settings => window.cdnUI.load(settings))"
    );
    await browserExpect(recovery).toBeVisible();
    const retry = page.locator('#cloudflare-cdn-retry');
    await page.setViewportSize({ width: 390, height: 844 });
    const panel = await recovery.boundingBox();
    expect(panel?.width).toBeLessThanOrEqual(390);
    await recovery.screenshot({ path: 'temp/tunnel-m4/screenshots/cdn-recovery-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect((await recovery.boundingBox())?.width).toBeGreaterThan(600);
    await recovery.screenshot({ path: 'temp/tunnel-m4/screenshots/cdn-recovery.png' });
    waitForRetry = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    await retry.click();
    await browserExpect(retry).toBeDisabled();
    await browserExpect(retry).toHaveText('Retrying setup…');
    await browserExpect(toggle).toBeDisabled();
    releaseRetry?.();
    await browserExpect(retry).toBeEnabled();
    await browserExpect(recovery).toBeVisible();
    await browserExpect(page.locator('#cloudflare-cdn-recovery-error')).toBeVisible();
    behavior = 'success';
    await retry.click();
    await browserExpect(recovery).toBeHidden();
    await browserExpect(toggle).toBeChecked();
    expect(requests.at(-1)).toEqual({ transitionId: 'transition' });
    await browserExpect(page.locator('.swal2-popup')).toHaveCount(0);
    behavior = 'reject';
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).toBeChecked();
    behavior = 'busy';
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).toBeChecked();
    expect(await page.evaluate('window.cdnAlerts.at(-1).message')).toMatch(
      /another settings change/i
    );
    behavior = 'lost';
    await toggle.click();
    await page.waitForFunction('window.cdnUI.pending === false');
    await browserExpect(toggle).toBeDisabled();
    await browserExpect(toggle).not.toBeChecked();
    await browserExpect(recovery).toBeVisible();
    await browserExpect(retry).toHaveText('Retry removal');
    behavior = 'success';
    await retry.click();
    await browserExpect(recovery).toBeHidden();
    await browserExpect(toggle).not.toBeChecked();
    expect(await page.locator('body').innerText()).not.toContain('SECRET_QUICK_NAME');
    expect(await page.evaluate('JSON.stringify(window.cdnAlerts)')).not.toContain(
      'SECRET_QUICK_NAME'
    );
    await browserExpect(page.getByRole('switch', { name: 'Cloudflare Tunnels' })).not.toBeChecked();
    await page.evaluate(
      "window.cdnUI.load({isCloudflareCdnEnabled:false,cloudflareAddressMigrationPending:true,cdnTransition:{id:'transition',targetEnabled:true,stage:'provider'}})"
    );
    await browserExpect(toggle).not.toBeChecked();
    await browserExpect(toggle).toBeDisabled();
    await browserExpect(page.locator('#cloudflare-cdn-recovery-title')).toHaveText(
      'CDN setup incomplete'
    );
    await page.evaluate(
      "window.cdnUI.load({isCloudflareCdnEnabled:true,cloudflareAddressMigrationPending:true,cdnTransition:{id:'transition',targetEnabled:false,stage:'provider'}})"
    );
    await browserExpect(toggle).toBeChecked();
    await browserExpect(page.locator('#cloudflare-cdn-recovery-title')).toHaveText(
      'CDN removal incomplete'
    );
  } finally {
    await browser.close();
  }
}, 30000);
