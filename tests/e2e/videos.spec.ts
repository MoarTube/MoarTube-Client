import {
  test,
  expect,
  clientResponse,
  expectSuccess,
  closeDialog,
  uniqueName,
  createMedia,
  importVideo,
  deleteVideo,
} from './fixtures.js';

test('imported video persists in real Node search after a Client reload', async ({
  signedInPage: page,
  importedVideo: video,
}) => {
  await page.reload();
  await page.locator('#search-input').fill(video.title);
  await expect(video.row).toContainText('imported');
  const empty = uniqueName('not-found');
  const search = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/videos/search' &&
      new URL(response.url()).searchParams.get('searchTerm') === empty
  );
  await page.locator('#search-input').fill(empty);
  expect((await search).ok()).toBeTruthy();
  await expect(page.locator('#videos_table tbody tr')).toHaveCount(0);
});

test('metadata edits persist through the Client manage dialog', async ({
  signedInPage: page,
  importedVideo: video,
}) => {
  await video.row.locator('.manage-button').click();
  await expect(page.locator('#importTitleInput')).toHaveValue(video.title);
  const description = 'Updated description with symbols & unicode café';
  await page.locator('#importDescriptionInput').fill(description);
  const saved = clientResponse(page, `/videos/${video.id}/data`);
  await page.locator('.swal2-confirm').click();
  await expectSuccess(saved);
  await page.reload();
  await page.locator('#search-input').fill(video.title);
  await video.row.locator('.manage-button').click();
  await expect(page.locator('#importDescriptionInput')).toHaveValue(description);
});

for (const permission of ['comments', 'likes', 'dislikes', 'reports', 'livechat']) {
  test(`changes ${permission} permission through the Client`, async ({
    signedInPage: page,
    importedVideo: video,
  }) => {
    await video.row.locator('.manage-button').click();
    await expect(page.locator('#importTitleInput')).toHaveValue(video.title);
    const loaded = clientResponse(page, `/videos/${video.id}/permissions`, 'GET');
    await page.locator('.moving-tab-selector-1[data-type="permissions"]').click();
    await expectSuccess(loaded);
    const checkbox = page.locator(`#manage-modal-permissions-${permission}-checkbox`);
    await expect(checkbox).toBeEnabled();
    const values = (await (await loaded).json()) as Record<string, unknown>;
    const fields: Record<string, string> = {
      comments: 'isCommentsEnabled',
      likes: 'isLikesEnabled',
      dislikes: 'isDislikesEnabled',
      reports: 'isReportsEnabled',
      livechat: 'isLiveChatEnabled',
    };
    await expect(checkbox).toBeChecked({ checked: Boolean(values[fields[permission]!]) });
    const original = await checkbox.isChecked();
    const saved = clientResponse(page, `/videos/${video.id}/permissions`);
    await checkbox.setChecked(!original);
    await expectSuccess(saved);
    await closeDialog(page);
    await page.reload();
    await page.locator('#search-input').fill(video.title);
    await video.row.locator('.manage-button').click();
    await expect(page.locator('#importTitleInput')).toHaveValue(video.title);
    const reloaded = clientResponse(page, `/videos/${video.id}/permissions`, 'GET');
    await page.locator('.moving-tab-selector-1[data-type="permissions"]').click();
    await expectSuccess(reloaded);
    await expect(checkbox).toBeChecked({ checked: !original });
  });
}

test('bulk delete cancellation preserves only the selected test video', async ({
  signedInPage: page,
  importedVideo: video,
}) => {
  await video.row.locator('.videos-table-select-video').check();
  await page.locator('#delete-selected-videos-button').click();
  await page.locator('.swal2-cancel').click();
  await page.reload();
  await page.locator('#search-input').fill(video.title);
  await expect(video.row).toBeVisible();
});

test('finalizes a real imported video through the Client', async ({
  signedInPage: page,
  importedVideo: video,
}) => {
  await video.row.locator('.videos-table-select-video').check();
  await page.locator('#finalize-selected-videos-button').click();
  const finalized = clientResponse(page, '/videos/finalize');
  await page.locator('.swal2-confirm').click();
  await expectSuccess(finalized);
  await page.reload();
  await page.locator('#search-input').fill(video.title);
  await expect(video.row).toContainText('finalized');
});

test('deletes a real imported video using the Client selected-video controls', async ({
  signedInPage: page,
}, testInfo) => {
  const file = testInfo.outputPath('delete-source.mp4');
  await createMedia(file);
  const video = await importVideo(page, file);
  await deleteVideo(page, video);
  await page.reload();
  await page.locator('#search-input').fill(video.title);
  await expect(page.locator('#videos_table tbody tr')).toHaveCount(0);
});

test('share dialog derives links from the real Node video', async ({
  signedInPage: page,
  importedVideo: video,
}) => {
  await video.row.locator('.share-button').click();
  await expect(page.locator('#node-video-url-input')).toHaveValue(
    new RegExp(`watch\\?v=${video.id}`)
  );
  await expect(page.locator('#video-embed-code-input')).toHaveValue(/iframe/);
});

for (const missing of ['title', 'description', 'tags', 'file']) {
  test(`import dialog validates missing ${missing}`, async ({ signedInPage: page }) => {
    await page.locator('#import-button').click();
    if (missing !== 'title') {
      await page.locator('#importTitleInput').fill(uniqueName('validation'));
    }
    if (missing !== 'description') {
      await page.locator('#importDescriptionInput').fill('Description');
    }
    if (missing !== 'tags') {
      await page.locator('.swal2-popup .choices__input--cloned').fill('e2e');
      await page.locator('.swal2-popup .choices__input--cloned').press('Enter');
    }
    await page.locator('.swal2-confirm').click();
    const messages = {
      title: 'enter a title',
      description: 'enter a description',
      tags: 'enter at least one tag',
      file: 'select a video file',
    };
    await expect(page.locator('.swal2-validation-message')).toContainText(
      messages[missing as keyof typeof messages]
    );
  });
}
