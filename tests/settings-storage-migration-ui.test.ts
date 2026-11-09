import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('shows unselected vertical migration choices, switches JSON inputs, and keeps failed drafts', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests: unknown[] = [];
  let fail = true;
  const rendered = ejs.render(await readFile('public/views/settings.ejs', 'utf8'), {
    model: { clientSettings: {}, nodeSettings: {} },
  });
  await page.route('http://moartube.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: rendered.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') });
    }
    try {
      return await route.fulfill({ body: await readFile('public' + pathname), contentType: pathname.endsWith('.css') ? 'text/css' : 'text/plain' });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('http://moartube.test/');
  await page.addStyleTag({ path: 'public/css/soft-ui-dashboard-1.1.0.min.css' });
  await page.addScriptTag({ path: 'public/javascript/jquery-3.6.4.min.js' });
  await page.addScriptTag({ path: 'public/javascript/sweetalert-11.0.11.min.js' });
  await page.addScriptTag({ path: 'public/javascript/settings-storage-migration.js' });
  await page.evaluate('new MoarTubeStorageMigration().start()');
  await page.route('http://moartube.test/settings/node/storage/migrate', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: fail
        ? { isError: true, message: 'S3 unavailable <img src=x>' }
        : { isError: false, filesCopied: 2 },
    });
  });
  const config = {
    credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    forcePathStyle: true,
  };
  const source = { bucketName: 'source-bucket', s3ProviderClientConfig: { ...config, forcePathStyle: false } };
  const destination = { bucketName: 'destination-bucket', s3ProviderClientConfig: config };
  try {
    await page.getByRole('button', { name: 'migrate', exact: true }).click();
    const choices = page.locator('input[name="storage-migration-direction"]');
    await browserExpect(choices).toHaveCount(3);
    await browserExpect(
      page.locator('input[name="storage-migration-direction"]:checked')
    ).toHaveCount(0);
    await browserExpect(page.locator('#migration-source')).toBeHidden();
    await browserExpect(page.locator('#migration-destination')).toBeHidden();
    for (let index = 1; index < 3; index++) {
      expect((await choices.nth(index).boundingBox())?.y ?? 0).toBeGreaterThan(
        (await choices.nth(index - 1).boundingBox())?.y ?? 0
      );
    }
    await page.getByRole('button', { name: 'Migrate', exact: true }).click();
    await browserExpect(page.locator('.swal2-validation-message')).toContainText(
      'Select a migration option'
    );
    await choices.nth(0).check();
    await browserExpect(page.locator('#migration-destination')).toBeVisible();
    await browserExpect(page.locator('#migration-source')).toBeHidden();
    await browserExpect(page.locator('#migration-source-bucket')).toBeHidden();
    await browserExpect(page.locator('#migration-destination-bucket')).toBeVisible();
    await browserExpect(page.locator('#migration-destination-url-format')).toHaveValue('path');
    await choices.nth(1).check();
    await browserExpect(page.locator('#migration-source')).toBeVisible();
    for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 700 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const popup = document.querySelector('.storage-migration-modal')!.getBoundingClientRect();
        const content = document.querySelector('.storage-migration-modal .swal2-html-container')!.getBoundingClientRect();
        const button = document.querySelector('.storage-migration-modal .swal2-confirm')!.getBoundingClientRect();
        const warning = document.querySelector('.storage-migration-warning')!;
        return {
          popupFits: popup.left >= 0 && popup.right <= innerWidth && popup.top >= 0 && popup.bottom <= innerHeight,
          buttonFits: button.left >= popup.left && button.right <= popup.right && button.bottom <= popup.bottom,
          noOverlap: button.top >= content.bottom,
          warningInFlow: getComputedStyle(warning).position === 'static',
        };
      });
      expect(layout).toEqual({ popupFits: true, buttonFits: true, noOverlap: true, warningInFlow: true });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    expect((await page.locator('#migration-destination').boundingBox())?.y ?? 0).toBeGreaterThan(
      (await page.locator('#migration-source').boundingBox())?.y ?? 0
    );
    await page.locator('#migration-source').fill(JSON.stringify(config));
    await page.locator('#migration-source-bucket').fill(' source-bucket ');
    await page.locator('#migration-source-url-format').selectOption('vhost');
    await page.locator('#migration-destination-bucket').fill('destination-bucket');
    await page.locator('#migration-destination').fill('invalid');
    await page.getByRole('button', { name: 'Migrate', exact: true }).click();
    await browserExpect(page.locator('.swal2-validation-message')).toContainText('valid JSON');
    expect(requests).toHaveLength(0);
    await page.locator('#migration-destination').fill(JSON.stringify(config));
    await page.getByRole('button', { name: 'Migrate', exact: true }).click();
    await browserExpect(page.locator('.swal2-validation-message')).toContainText(
      'S3 unavailable <img src=x>'
    );
    await browserExpect(page.locator('.swal2-validation-message img')).toHaveCount(0);
    await browserExpect(page.locator('#migration-source')).toHaveValue(JSON.stringify(config));
    await browserExpect(page.locator('#migration-source-bucket')).toHaveValue(' source-bucket ');
    await browserExpect(page.locator('#migration-source-url-format')).toHaveValue('vhost');
    expect(requests.at(-1)).toEqual({ direction: 's3-to-s3', source, destination });
    fail = false;
    await choices.nth(2).check();
    await browserExpect(page.locator('#migration-destination')).toBeHidden();
    await page.getByRole('button', { name: 'Migrate', exact: true }).click();
    await browserExpect(page.locator('.swal2-title')).toHaveText('Migration complete');
    expect(requests.at(-1)).toEqual({ direction: 's3-to-filesystem', source });
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('button', { name: 'migrate', exact: true }).click();
    await browserExpect(
      page.locator('input[name="storage-migration-direction"]:checked')
    ).toHaveCount(0);
    await choices.nth(0).check();
    await page.locator('#migration-destination-bucket').fill('destination-bucket');
    await page.locator('#migration-destination').fill(JSON.stringify(config));
    await page.getByRole('button', { name: 'Migrate', exact: true }).click();
    await browserExpect(page.locator('.swal2-title')).toHaveText('Migration complete');
    expect(requests.at(-1)).toEqual({ direction: 'filesystem-to-s3', destination });
  } finally {
    await browser.close();
  }
}, 30_000);
