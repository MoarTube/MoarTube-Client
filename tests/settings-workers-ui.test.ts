import { readFile, mkdir } from 'node:fs/promises';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('shows the worker dropdown without redundant status text and confirms only decreases', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const html = ejs.render(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
    model: { clientSettings: { isGpuAccelerationSupported: false } },
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let saved = 3;
  let running = 3;
  let blocked = false;
  const mutations: unknown[] = [];
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/settings/node/workers') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        mutations.push(body);
        if (blocked) {
          await route.fulfill({
            status: 409,
            json: {
              isError: true,
              message:
                'Stop active imports, publishing jobs, uploads, and live streams before lowering the worker count.',
            },
          });
          return;
        }
        saved = body.workerCount;
        running = saved === 0 ? 8 : saved;
      }
      await route.fulfill({
        json: { isError: false, workerCount: saved, runningWorkers: running, maxWorkers: 8 },
      });
      return;
    }
    if (pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: html });
      return;
    }
    try {
      await route.fulfill({
        contentType: pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream',
        body: await readFile('public' + decodeURIComponent(pathname)),
      });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  try {
    await page.goto('http://moartube.test/');
    await page.addScriptTag({ path: 'public/javascript/jquery-3.6.4.min.js' });
    await page.addScriptTag({ path: 'public/javascript/settings-workers.js' });
    await page.evaluate(
      `window.confirmations = []; window.acceptDecrease = true; window.Swal = {fire: async (options) => { window.confirmations.push(options); return {isConfirmed: window.acceptDecrease}; }}; window.workerAlerts = []; window.workers = new MoarTubeWorkerSettings((isError, message) => window.workerAlerts.push({isError, message})); window.workers.start();`,
    );
    const select = page.locator('#worker-count-select');
    const button = page.locator('#worker-count-save');
    const status = page.locator('#worker-count-status');
    await browserExpect(select).toBeEnabled();
    await browserExpect(select.locator('option')).toHaveCount(9);
    await browserExpect(select).toHaveValue('3');
    await browserExpect(button).toHaveText('Save');
    expect(await select.getAttribute('class')).toBe(await page.locator('#public-node-protocol-select').getAttribute('class'));
    const portBox = await page.locator('#node-listening-port-input').boundingBox();
    const workerBox = await select.boundingBox();
    expect(Math.abs(portBox!.x - workerBox!.x)).toBeLessThan(1);
    expect(Math.abs(portBox!.width - workerBox!.width)).toBeLessThan(1);
    await browserExpect(page.locator('#worker-count-range')).toHaveCount(0);
    await browserExpect(status).toBeHidden();
    expect(
      await page.evaluate(
        `Boolean(document.querySelector('#node-listening-port-input').compareDocumentPosition(document.querySelector('#worker-count-form')) & Node.DOCUMENT_POSITION_FOLLOWING)`,
      ),
    ).toBe(true);

    await select.selectOption('5');
    await button.click();
    await browserExpect(button).toBeEnabled();
    await browserExpect(status).toBeHidden();
    expect(await page.evaluate('window.workerAlerts.at(-1)')).toEqual({isError: false});
    expect(mutations.at(-1)).toEqual({ workerCount: 5, confirmDecrease: false });
    expect(await page.evaluate('window.confirmations.length')).toBe(0);

    await page.evaluate('window.acceptDecrease = false');
    await select.selectOption('2');
    await button.click();
    await browserExpect(button).toBeEnabled();
    expect(mutations).toHaveLength(1);
    expect(await page.evaluate('window.confirmations[0].text')).toContain('may interrupt');

    await page.evaluate('window.acceptDecrease = true');
    blocked = true;
    await button.click();
    await browserExpect(button).toBeEnabled();
    expect(await page.evaluate('window.workerAlerts.at(-1)')).toMatchObject({isError: true, message: expect.stringContaining('Stop active imports')});
    expect(mutations.at(-1)).toEqual({ workerCount: 2, confirmDecrease: true });
    await browserExpect(select).toHaveValue('5');
    expect(saved).toBe(5);

    blocked = false;
    await select.selectOption('1');
    await button.click();
    await browserExpect(button).toBeEnabled();
    await browserExpect(status).toBeHidden();
    expect(await page.evaluate('window.workerAlerts.at(-1)')).toEqual({isError: false});
    await browserExpect(select).toHaveValue('1');
    expect(saved).toBe(1);

    await select.selectOption('0');
    await button.click();
    await browserExpect(button).toBeEnabled();
    await browserExpect(status).toBeHidden();
    expect(await page.evaluate('window.workerAlerts.at(-1)')).toEqual({isError: false});
    await browserExpect(select).toHaveValue('0');
    expect(mutations.at(-1)).toEqual({ workerCount: 0, confirmDecrease: false });
    await mkdir('temp/worker-settings/screenshots', { recursive: true });
    await page
      .locator('section[aria-label="Network"]')
      .screenshot({ path: 'temp/worker-settings/screenshots/workers-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator('section[aria-label="Network"]')
      .screenshot({ path: 'temp/worker-settings/screenshots/workers-mobile.png' });
  } finally {
    await browser.close();
  }
}, 30000);
