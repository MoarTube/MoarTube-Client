import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('validates the fourth modal field, preserves tunnel preference, and refreshes partial CDN changes', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const html = ejs.render(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
    model: { clientSettings: { isGpuAccelerationSupported: false } },
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let cdn = false;
  let behavior: 'success' | 'partial' | 'reject' | 'lost' | 'busy' = 'success';
  let writes = 0;
  const requests: object[] = [];
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      pathname === '/settings/node/cloudflare/configure' ||
      pathname === '/settings/node/cloudflare/clear'
    ) {
      writes++;
      requests.push(route.request().postDataJSON() as object);
      if (behavior !== 'reject' && behavior !== 'busy') {
        cdn = pathname.endsWith('/configure');
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
    for (const script of [
      'jquery-3.6.4.min.js',
      'sweetalert-11.0.11.min.js',
      'settings-cloudflare-tunnel.js',
      'settings-cloudflare-cdn.js',
    ]) {
      await page.addScriptTag({ path: 'public/javascript/' + script });
    }
    await page.evaluate(
      `window.cdnAlerts=[]; window.tunnelUI=new MoarTubeCloudflareTunnelToggle(()=>{}); window.tunnelUI.load({isCloudflareTunnelEnabled:false}); window.cdnUI=new MoarTubeCloudflareCdn((error,message)=>window.cdnAlerts.push({error,message}),window.tunnelUI); window.cdnUI.load({isCloudflareCdnEnabled:false}); $('#cloudflare-one-click-cdn-checkbox').on('change',()=>void window.cdnUI.toggle());`
    );
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
    await browserExpect(page.getByLabel('Cloudflare Tunnel Name', { exact: true })).toHaveValue('');
    await browserExpect(page.getByLabel('Cloudflare Tunnel Name', { exact: true })).toHaveAttribute(
      'placeholder',
      'name'
    );
    await page.getByRole('button', { name: 'Close this dialog' }).click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    expect(writes).toBe(0);
    await openForm();
    await fillForm();
    await page.getByLabel('Cloudflare Tunnel Name', { exact: true }).fill('   ');
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await browserExpect(page.locator('.swal2-validation-message')).toBeVisible();
    expect(writes).toBe(0);
    await page.getByLabel('Cloudflare Tunnel Name', { exact: true }).fill('https://invalid');
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    expect(writes).toBe(0);
    await page.getByLabel('Cloudflare Tunnel Name', { exact: true }).fill('  My Named Tunnel  ');
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
      cloudflareTunnelName: 'My Named Tunnel',
    });
    await browserExpect(page.getByRole('switch', { name: 'Cloudflare Tunnels' })).not.toBeChecked();
    await toggle.click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    behavior = 'partial';
    await openForm();
    await fillForm();
    await page.getByLabel('Cloudflare Tunnel Name', { exact: true }).fill('Another Name');
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).toBeChecked();
    expect(await page.evaluate('window.cdnAlerts.at(-1).message')).toMatch(/settings saved, but/i);
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
    await browserExpect(toggle).toBeEnabled();
    await browserExpect(toggle).not.toBeChecked();
    expect(await page.locator('body').innerText()).not.toContain('SECRET_QUICK_NAME');
    expect(await page.evaluate('JSON.stringify(window.cdnAlerts)')).not.toContain(
      'SECRET_QUICK_NAME'
    );
    await browserExpect(page.getByRole('switch', { name: 'Cloudflare Tunnels' })).not.toBeChecked();
  } finally {
    await browser.close();
  }
}, 30000);
