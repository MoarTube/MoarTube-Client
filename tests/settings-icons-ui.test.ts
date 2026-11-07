import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';
import type { NodeIcon } from '../src/types/node-api.js';

it('edits URL/SVG pairs, validates incomplete rows, retains drafts, reloads and clears icons', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const literal =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="window.nodeIconExecuted=true"><script>window.nodeIconExecuted=true</script></svg>';
  let saved: NodeIcon[] = [{ url: 'https://rivet.tube', svgGraphic: literal }];
  let fail = false;
  let saves = 0;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/settings/node/personalize/icons') {
      saves++;
      if (fail) {
        await route.fulfill({
          status: 500,
          json: { isError: true, message: 'Storage unavailable' },
        });
      } else {
        saved = (route.request().postDataJSON() as { nodeIcons: NodeIcon[] }).nodeIcons;
        await route.fulfill({ json: { isError: false, nodeIcons: saved } });
      }
      return;
    }
    if (pathname === '/') {
      const rendered = ejs.render(template, {
        model: { clientSettings: {}, nodeSettings: { nodeIcons: saved } },
      });
      const assignment = rendered.match(/const INCOMING_PARAMETERS = [^\r\n]+;/)?.[0];
      if (assignment === undefined) {
        throw new Error('Missing serialized settings');
      }
      const html = rendered.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(
        '</body>',
        `
        <script src="/javascript/jquery-3.6.4.min.js"></script>
        <script src="/javascript/settings-icons.js"></script>
        <script>${assignment}
          window.nodeIconAlerts = [];
          window.nodeIconUI = new MoarTubeNodeIcons((...args) => window.nodeIconAlerts.push(args));
          window.nodeIconUI.load(INCOMING_PARAMETERS.nodeSettings);
          window.nodeIconUI.start();
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
    const form = page.getByRole('form', { name: 'Node Icons', exact: true });
    const rows = form.locator('.node-icons-row');
    await browserExpect(page.locator('a[href="/links"]')).toHaveCount(0);
    const add = form.getByRole('button', { name: 'Add item', exact: true });
    const resources = form.locator('#node-icons-resources');
    await browserExpect(resources).toBeVisible();
    const save = form.getByRole('button', { name: 'Save', exact: true });
    await browserExpect(
      page.getByRole('region', { name: 'Personalization', exact: true }).locator('#node-icons-rows')
    ).toHaveCount(1);
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(form.getByLabel('Icon 1 SVG graphic', { exact: true })).toHaveValue(
      literal
    );
    expect(await page.evaluate('window.nodeIconExecuted')).toBeUndefined();
    await browserExpect(form.locator('svg')).toHaveCount(0);
    await add.click();
    await browserExpect(form.getByLabel('Icon 2 URL', { exact: true })).toBeFocused();
    await form.getByLabel('Icon 2 URL', { exact: true }).fill('https://gearhead.tube');
    await save.click();
    expect(saves).toBe(0);
    await browserExpect(form.getByLabel('Icon 2 SVG graphic', { exact: true })).toBeFocused();
    await form
      .getByLabel('Icon 2 SVG graphic', { exact: true })
      .fill(
        ' <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"/> '
      );
    await form.getByLabel('Icon 2 URL', { exact: true }).fill('javascript:alert(1)');
    await save.click();
    expect(saves).toBe(0);
    await form.getByLabel('Icon 2 URL', { exact: true }).fill('https://gearhead.tube');
    await form
      .getByLabel('Icon 1 SVG graphic', { exact: true })
      .fill('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"/>');
    await form.getByLabel('Icon 2 SVG graphic', { exact: true }).fill('<svg>');
    await save.click();
    expect(saves).toBe(0);
    await browserExpect(form.getByLabel('Icon 2 SVG graphic', { exact: true })).toBeFocused();
    await rows.nth(1).getByRole('button', { name: 'Use sample icon 1', exact: true }).click();
    expect(await form.getByLabel('Icon 2 SVG graphic', { exact: true }).inputValue()).toContain(
      'bi-meta'
    );
    await form
      .getByLabel('Icon 2 SVG graphic', { exact: true })
      .fill(
        ' <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"/> '
      );
    fail = true;
    await save.click();
    await browserExpect(form.getByRole('status')).toContainText('not confirmed saved');
    await browserExpect(form.getByLabel('Icon 2 SVG graphic', { exact: true })).toHaveValue(
      ' <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"/> '
    );
    await browserExpect(save).toBeEnabled();
    fail = false;
    await add.click(); // A fully empty draft row is skipped on save.
    await save.click();
    await browserExpect.poll(() => page.evaluate('window.nodeIconAlerts.at(-1)')).toEqual([false]);
    await browserExpect(form.getByRole('status')).toBeEmpty();
    expect(saved).toEqual([
      {
        url: 'https://rivet.tube',
        svgGraphic:
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"/>',
      },
      {
        url: 'https://gearhead.tube',
        svgGraphic:
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"/>',
      },
    ]);
    await page.reload();
    await browserExpect(rows).toHaveCount(2);
    await browserExpect(form.getByLabel('Icon 2 SVG graphic', { exact: true })).toHaveValue(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"/>'
    );
    await mkdir('temp/icons/screenshots', { recursive: true });
    await form.screenshot({ path: 'temp/icons/screenshots/desktop.png' });
    const addBox = await add.boundingBox();
    const saveBox = await save.boundingBox();
    if (!addBox || !saveBox) {
      throw new Error('Missing editor actions');
    }
    expect(saveBox.x - (addBox.x + addBox.width)).toBeGreaterThan(0);
    expect(saveBox.x - (addBox.x + addBox.width)).toBeLessThan(16);
    await page.setViewportSize({ width: 390, height: 844 });
    await form.screenshot({ path: 'temp/icons/screenshots/mobile.png' });
    expect(
      await form.evaluate(
        (element: { scrollWidth: number; clientWidth: number }) =>
          element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    await form.getByRole('button', { name: 'Remove icon 1', exact: true }).click();
    await browserExpect(form.getByLabel('Icon 1 URL', { exact: true })).toHaveValue(
      'https://gearhead.tube'
    );
    await form.getByRole('button', { name: 'Remove icon 1', exact: true }).click();
    await browserExpect(resources).toBeHidden();
    await save.click();
    await browserExpect.poll(() => page.evaluate('window.nodeIconAlerts.at(-1)')).toEqual([false]);
    expect(saved).toEqual([]);
    await page.reload();
    await browserExpect(rows).toHaveCount(0);
    await browserExpect(form.locator('#node-icons-empty')).toBeVisible();
    await browserExpect(resources).toBeHidden();
    expect(saves).toBe(3);
    for (let index = 0; index < 5; index++) {await add.click();}
    await browserExpect(rows).toHaveCount(5);
    await browserExpect(resources).toBeVisible();
    await browserExpect(add).toBeDisabled();
    await form.getByRole('button', { name: 'Remove icon 1', exact: true }).click();
    await browserExpect(add).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
