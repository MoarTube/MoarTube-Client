import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('edits ordered bulletin rows, retains failed drafts, reloads saves, and clears the bulletin', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const literal =
    '</script><script>window.bulletinExecuted=true</script><img src=x onerror="window.bulletinExecuted=true">';
  let saved = ['Welcome to this node.', literal];
  let fail = false;
  let saves = 0;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/settings/node/personalize/bulletin') {
      saves++;
      if (fail) {
        await route.fulfill({
          status: 500,
          json: { isError: true, message: 'Storage unavailable' },
        });
      } else {
        saved = (route.request().postDataJSON() as { nodeBulletin: string[] }).nodeBulletin;
        await route.fulfill({ json: { isError: false, nodeBulletin: saved } });
      }
      return;
    }
    if (pathname === '/') {
      const rendered = ejs.render(template, {
        model: { clientSettings: {}, nodeSettings: { nodeBulletin: saved } },
      });
      const assignment = rendered.match(/const INCOMING_PARAMETERS = [^\r\n]+;/)?.[0];
      if (assignment === undefined) {
        throw new Error('Missing serialized settings');
      }
      const html = rendered.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(
        '</body>',
        `
        <script src="/javascript/jquery-3.6.4.min.js"></script>
        <script src="/javascript/settings-bulletin.js"></script>
        <script>${assignment}
          window.bulletinAlerts = [];
          window.bulletinUI = new MoarTubeNodeBulletin((...args) => window.bulletinAlerts.push(args));
          window.bulletinUI.load(INCOMING_PARAMETERS.nodeSettings);
          window.bulletinUI.start();
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
    const form = page.getByRole('form', { name: 'Node Bulletin', exact: true });
    await browserExpect(
      page
        .getByRole('region', { name: 'Personalization', exact: true })
        .locator('#node-bulletin-rows')
    ).toHaveCount(1);
    const items = form.locator('textarea');
    await browserExpect(items).toHaveCount(2);
    await browserExpect(items.nth(1)).toHaveValue(literal);
    expect(await page.evaluate('window.bulletinExecuted')).toBeUndefined();
    await browserExpect(form.locator('img')).toHaveCount(0);
    await form.getByRole('button', { name: 'Add item', exact: true }).click();
    await browserExpect(items.nth(2)).toBeFocused();
    await items.nth(2).fill(' Third item ');
    await form.getByRole('button', { name: 'Remove bulletin item 2', exact: true }).click();
    await browserExpect(items.nth(1)).toHaveValue(' Third item ');
    fail = true;
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await browserExpect(form.getByRole('status')).toContainText('not confirmed saved');
    await browserExpect(items.nth(1)).toHaveValue(' Third item ');
    await browserExpect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    fail = false;
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await browserExpect.poll(() => page.evaluate('window.bulletinAlerts.at(-1)')).toEqual([false]);
    await browserExpect(form.getByRole('status')).toBeEmpty();
    expect(saved).toEqual(['Welcome to this node.', 'Third item']);
    await page.reload();
    await browserExpect(items.nth(1)).toHaveValue('Third item');
    await mkdir('temp/bulletin/screenshots', { recursive: true });
    await form.screenshot({ path: 'temp/bulletin/screenshots/desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await form.screenshot({ path: 'temp/bulletin/screenshots/mobile.png' });
    expect(
      await form.evaluate(
        (element: { scrollWidth: number; clientWidth: number }) =>
          element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    await form.getByRole('button', { name: 'Remove bulletin item 1', exact: true }).click();
    await form.getByRole('button', { name: 'Remove bulletin item 1', exact: true }).click();
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await browserExpect.poll(() => page.evaluate('window.bulletinAlerts.at(-1)')).toEqual([false]);
    await browserExpect(form.getByRole('status')).toBeEmpty();
    expect(saved).toEqual([]);
    await page.reload();
    await browserExpect(items).toHaveCount(0);
    await browserExpect(form.locator('#node-bulletin-empty')).toBeVisible();
    expect(saves).toBe(3);
    const add = form.getByRole('button', { name: 'Add item', exact: true });
    for (let index = 0; index < 10; index++) {
      await add.click();
    }
    await browserExpect(items).toHaveCount(10);
    await browserExpect(add).toBeDisabled();
    await form.getByRole('button', { name: 'Remove bulletin item 1', exact: true }).click();
    await browserExpect(add).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
