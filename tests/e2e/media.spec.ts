import {
  test,
  expect,
  createMedia,
  importVideo,
  deleteVideo,
  clientResponse,
  expectSuccess,
  closeDialog,
} from './fixtures.js';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

for (const [name, options] of [
  ['MP4', { extension: 'mp4' }],
  ['WEBM', { extension: 'webm' }],
  ['portrait MP4', { size: '240x426' }],
  ['silent MP4', { silent: true }],
] as const) {
  test(`imports ${name} through the Client and displays the generated thumbnail`, async ({
    signedInPage: page,
  }, testInfo) => {
    const extension = 'extension' in options ? options.extension : 'mp4';
    const file = testInfo.outputPath(`source.${extension}`);
    await createMedia(file, options);
    const video = await importVideo(page, file);
    try {
      const image = video.row.locator('img');
      await expect(image).toBeVisible();
      await expect
        .poll(async () => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBe(100);
    } finally {
      await deleteVideo(page, video);
    }
  });
}

for (const [kind, width, height] of [
  ['thumbnail', 100, 100],
  ['preview', 512, 288],
  ['poster', 1280, 720],
] as const) {
  test(`uploads and resizes a video ${kind} through the Client image picker`, async ({
    signedInPage: page,
    importedVideo: video,
  }) => {
    const buffer = await sharp({
      create: { width: 80, height: 60, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    await video.row.locator('.thumbnail-button').click();
    const upload = clientResponse(page, `/videos/${video.id}/images/${kind}`);
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(`/images/${kind}.jpg`) &&
        new URL(response.url()).searchParams.has('cache-bust')
    );
    await page
      .locator(`#upload-${kind}-input`)
      .setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer });
    await expectSuccess(upload);
    const served = await refreshed;
    expect(served.ok()).toBeTruthy();
    const metadata = await sharp(await served.body()).metadata();
    expect(metadata).toMatchObject({ width, height });
  });
}

for (const format of ['mp4', 'webm', 'm3u8', 'ogv']) {
  test(`publishes ${format} from the Client wizard to the real Node`, async ({
    signedInPage: page,
    importedVideo: video,
  }) => {
    test.setTimeout(180_000);
    await video.row.locator('.publish-wizard-button').click();
    await page.locator(`[id="${video.id}_${format}_240p_publish_checkbox"]`).check();
    const published = clientResponse(page, `/videos/${video.id}/publish`);
    await page.locator('.swal2-confirm').click();
    await expectSuccess(published);
    await expect(page.locator(`[id="${video.id}_${format}_240p_publish_checkbox"]`)).toHaveClass(
      /form-check-input-is-published/,
      { timeout: 120_000 }
    );
    await closeDialog(page);
    await page.reload();
    await page.locator('#search-input').fill(video.title);
    await expect(video.row).toContainText('published');
    await video.row.locator('.share-button').click();
    const sources = page.locator('#direct-source-links-select option');
    await expect(sources).not.toHaveCount(0);
    expect(await sources.allTextContents()).toEqual(
      expect.arrayContaining([expect.stringContaining(format)])
    );
  });
}

test('exports the real Node database through the Client download link', async ({
  signedInPage: page,
}, testInfo) => {
  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('button', { name: 'export', exact: true }) })
    .click();
  const result = await download;
  expect(result.suggestedFilename()).toMatch(/^database-\d+\.json$/);
  const file = testInfo.outputPath(result.suggestedFilename());
  await result.saveAs(file);
  const database: unknown = JSON.parse(await readFile(file, 'utf8'));
  expect(database).toBeTruthy();
  expect(typeof database).toBe('object');
});
