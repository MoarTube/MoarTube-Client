import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('saves the node name from the real settings form and reloads the saved value', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const settings = {
    nodeName: 'Original name',
    nodeHeadline: 'Headline',
    nodeAbout: 'About',
    databaseConfig: { databaseDialect: 'sqlite' },
    storageConfig: { storageMode: 'filesystem' },
  };
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  const saves: unknown[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      await route.fulfill({
        contentType: 'text/html',
        body: ejs.render(template, {
          model: { nodeSettings: settings, clientSettings: {}, newContentCounts: {} },
        }),
      });
    } else if (pathname === '/settings/node/personalize/name') {
      const payload = route.request().postDataJSON() as { nodeName: string };
      saves.push(payload);
      settings.nodeName = payload.nodeName;
      await route.fulfill({ json: { isError: false } });
    } else if (pathname.startsWith('/settings/')) {
      await route.fulfill({ json: { isError: false } });
    } else {
      try {
        await route.fulfill({ path: path.join(process.cwd(), 'public', pathname) });
      } catch {
        await route.fulfill({ status: 404, body: '' });
      }
    }
  });
  try {
    await page.goto('http://moartube.test/');
    const input = page.getByLabel('Node Name', { exact: true });
    await browserExpect(input).toHaveValue('Original name');
    await input.fill('My renamed node');
    await page
      .locator('#personalize_settings_node_name_form')
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await browserExpect(page.locator('.swal2-success')).toBeVisible();
    expect(saves).toEqual([{ nodeName: 'My renamed node' }]);
    await page.reload();
    await browserExpect(input).toHaveValue('My renamed node');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
