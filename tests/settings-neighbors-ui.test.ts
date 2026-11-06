import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';
import type { NodeNeighbor } from '../src/types/node-api.js';

it('edits URL/description pairs, validates incomplete rows, retains drafts, reloads and clears neighbors', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const literal =
    '</script><script>window.neighborExecuted=true</script><img src=x onerror="window.neighborExecuted=true">';
  let saved: NodeNeighbor[] = [{ url: 'https://rivet.tube', description: literal }];
  let fail = false;
  let saves = 0;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/settings/node/personalize/neighbors') {
      saves++;
      if (fail) {
        await route.fulfill({
          status: 500,
          json: { isError: true, message: 'Storage unavailable' },
        });
      } else {
        saved = (route.request().postDataJSON() as { nodeNeighbors: NodeNeighbor[] }).nodeNeighbors;
        await route.fulfill({ json: { isError: false, nodeNeighbors: saved } });
      }
      return;
    }
    if (pathname === '/') {
      const rendered = ejs.render(template, {
        model: { clientSettings: {}, nodeSettings: { nodeNeighbors: saved } },
      });
      const assignment = rendered.match(/const INCOMING_PARAMETERS = [^\r\n]+;/)?.[0];
      if (assignment === undefined) {
        throw new Error('Missing serialized settings');
      }
      const html = rendered.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(
        '</body>',
        `
        <script src="/javascript/jquery-3.6.4.min.js"></script>
        <script src="/javascript/settings-neighbors.js"></script>
        <script>${assignment}
          window.neighborAlerts = [];
          window.neighborUI = new MoarTubeNodeNeighbors((...args) => window.neighborAlerts.push(args));
          window.neighborUI.load(INCOMING_PARAMETERS.nodeSettings);
          window.neighborUI.start();
        </script></body>`
      );
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
    const form = page.getByRole('form', { name: 'Neighbors', exact: true });
    const rows = form.locator('.node-neighbors-row');
    const add = form.getByRole('button', { name: 'Add item', exact: true });
    const save = form.getByRole('button', { name: 'Save', exact: true });
    await browserExpect(
      page
        .getByRole('region', { name: 'Personalization', exact: true })
        .locator('#node-neighbors-rows')
    ).toHaveCount(1);
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(form.getByLabel('Neighbor 1 description', { exact: true })).toHaveValue(
      literal
    );
    expect(await page.evaluate('window.neighborExecuted')).toBeUndefined();
    await browserExpect(form.locator('img')).toHaveCount(0);
    await add.click();
    await browserExpect(form.getByLabel('Neighbor 2 URL', { exact: true })).toBeFocused();
    await form.getByLabel('Neighbor 2 URL', { exact: true }).fill('https://gearhead.tube');
    await save.click();
    expect(saves).toBe(0);
    await browserExpect(form.getByLabel('Neighbor 2 description', { exact: true })).toBeFocused();
    await form
      .getByLabel('Neighbor 2 description', { exact: true })
      .fill(' Electronics, tools, and making ');
    await form.getByLabel('Neighbor 2 URL', { exact: true }).fill('javascript:alert(1)');
    await save.click();
    expect(saves).toBe(0);
    await form.getByLabel('Neighbor 2 URL', { exact: true }).fill('https://gearhead.tube');
    await form
      .getByLabel('Neighbor 1 description', { exact: true })
      .fill('Indie film, animation, and art');
    fail = true;
    await save.click();
    await browserExpect(form.getByRole('status')).toContainText('not confirmed saved');
    await browserExpect(form.getByLabel('Neighbor 2 description', { exact: true })).toHaveValue(
      ' Electronics, tools, and making '
    );
    await browserExpect(save).toBeEnabled();
    fail = false;
    await add.click(); // A fully empty draft row is skipped on save.
    await save.click();
    await browserExpect.poll(() => page.evaluate('window.neighborAlerts.at(-1)')).toEqual([false]);
    await browserExpect(form.getByRole('status')).toBeEmpty();
    expect(saved).toEqual([
      { url: 'https://rivet.tube', description: 'Indie film, animation, and art' },
      { url: 'https://gearhead.tube', description: 'Electronics, tools, and making' },
    ]);
    await page.reload();
    await browserExpect(rows).toHaveCount(2);
    await browserExpect(form.getByLabel('Neighbor 2 description', { exact: true })).toHaveValue(
      'Electronics, tools, and making'
    );
    await mkdir('temp/neighbors/screenshots', { recursive: true });
    await form.screenshot({ path: 'temp/neighbors/screenshots/desktop.png' });
    const addBox = await add.boundingBox();
    const saveBox = await save.boundingBox();
    if (!addBox || !saveBox) {
      throw new Error('Missing editor actions');
    }
    expect(saveBox.x - (addBox.x + addBox.width)).toBeGreaterThan(0);
    expect(saveBox.x - (addBox.x + addBox.width)).toBeLessThan(16);
    await page.setViewportSize({ width: 390, height: 844 });
    await form.screenshot({ path: 'temp/neighbors/screenshots/mobile.png' });
    expect(
      await form.evaluate(
        (element: { scrollWidth: number; clientWidth: number }) =>
          element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    await form.getByRole('button', { name: 'Remove neighbor 1', exact: true }).click();
    await browserExpect(form.getByLabel('Neighbor 1 URL', { exact: true })).toHaveValue(
      'https://gearhead.tube'
    );
    await form.getByRole('button', { name: 'Remove neighbor 1', exact: true }).click();
    await save.click();
    await browserExpect.poll(() => page.evaluate('window.neighborAlerts.at(-1)')).toEqual([false]);
    expect(saved).toEqual([]);
    await page.reload();
    await browserExpect(rows).toHaveCount(0);
    await browserExpect(form.locator('#node-neighbors-empty')).toBeVisible();
    expect(saves).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
