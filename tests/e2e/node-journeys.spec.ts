import { observe } from './fixtures.js';
import { readFile } from 'node:fs/promises';
import {
  test,
  expect,
  publishVideo,
  expectPlayback,
  watchVideo,
  openComments,
  postComment,
  setVideoPermission,
  tableRow,
  submitReport,
} from './node-fixtures.js';
import { uniqueName, clientResponse, expectSuccess } from './fixtures.js';
import { NODE_URL } from './support/check-node.js';

test.beforeEach(() => {
  test.setTimeout(180_000);
});

test('Client publication is discoverable through Node search, sorting and tags', async ({
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await viewer.goto('/videos');
  await viewer.locator('#search-input').fill(video.title);
  const card = viewer.locator(`#videos-container a[href="/watch?v=${video.id}"]`);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(video.title);
  for (const sort of ['popular', 'oldest', 'latest']) {
    const response = clientResponse(viewer, '/node/search', 'GET');
    await viewer.locator(`#sort-button-${sort}`).click();
    await expectSuccess(response);
    await expect(card).toHaveCount(1);
  }
  await viewer.locator('.tag-button').filter({ hasText: /^e2e$/ }).click();
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(viewer.locator('#video-title')).toHaveText(video.title);
  await expect(viewer.locator('#video-information-description')).toContainText(
    'Created by MoarTube Client Playwright'
  );
});

for (const format of ['mp4', 'webm', 'm3u8']) {
  test.describe(() => {
    test.skip(
      ({ browserName }) =>
        browserName === 'webkit' && format === 'm3u8' && process.platform !== 'darwin',
      'WebKit HLS playback is restricted to macOS.'
    );

    test(`Client-published ${format} plays in the Node viewer`, async ({
      signedInPage: page,
      importedVideo: video,
      viewerPage: viewer,
    }) => {
      await publishVideo(page, video, format);
      await watchVideo(viewer, video);
      await expectPlayback(viewer);
    });
  });
}

test('Node download links serve the OGV published through Client', async ({
  signedInPage: page,
  importedVideo: video,
  viewerPage: viewer,
}) => {
  await publishVideo(page, video, 'ogv');
  await watchVideo(viewer, video);
  await viewer.locator('#overflow-dropdown-button').click();
  await viewer.locator('#video-download-button').click();
  const link = viewer.locator('.swal2-popup a[href$=".ogv"]');
  await expect(link).toHaveCount(1);
  const linkUrl = await link.getAttribute('href');
  expect(linkUrl).not.toBeNull();
  const targetUrl = new URL(linkUrl!, NODE_URL).toString();
  const response = observe(viewer.waitForResponse((result) => result.url() === targetUrl));
  expect(linkUrl).toContain(video.id);
  // A browser download does not necessarily produce a Page response event.
  // Observe the actual download or committed media navigation before clicking.
  const downloaded = observe(
    viewer.waitForEvent('download').then((download) => ({ kind: 'download' as const, download }))
  );
  const navigated = observe(
    viewer
      .waitForURL(targetUrl, { waitUntil: 'domcontentloaded' })
      .then(() => ({ kind: 'navigation' as const }))
  );
  await link.click();
  const received = await Promise.race([downloaded, navigated]);
  let bytes: Buffer;
  if (received.kind === 'download') {
    expect(received.download.url()).toBe(targetUrl);
    expect(await received.download.failure()).toBeNull();
    const file = await received.download.path();
    expect(file).not.toBeNull();
    bytes = await readFile(file!);
  } else {
    const served = await response;
    expect(served.ok()).toBe(true);
    // Native browser media documents can keep their navigation response open.
    // After verifying the real click/navigation, inspect the exact same public
    // source with a separate read-only HTTP request rather than waiting forever
    // for that media document's response body to finish.
    const source = await viewer.context().request.get(targetUrl, { timeout: 15_000 });
    expect(source.ok()).toBe(true);
    bytes = await source.body();
  }
  expect(bytes.subarray(0, 4).toString()).toBe('OggS');
});

test('Node share links open the real embedded player for a Client-published video', async ({
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await watchVideo(viewer, video);
  await viewer.locator('#video-share-button').click();
  await expect(viewer.locator('#node-video-url-input')).toHaveValue(
    new RegExp(`watch\\?v=${video.id}`)
  );
  const url = await viewer.locator('#video-embed-url-input').inputValue();
  await expect(viewer.locator('#video-embed-code-input')).toHaveValue(/iframe/);
  expect(new URL(url).origin).toBe(NODE_URL);
  const embed = await viewer.context().newPage();
  await embed.goto(url);
  await expect(embed.locator('#mtp-video-title')).toHaveText(video.title);
  await embed.locator('.mtp-large-play-button').click();
  // The embed's overlay starts playback asynchronously. A second Play click
  // can pause or restart that same request before playback is observed.
  await expectPlayback(embed, true);
});

test('Client metadata changes appear on Node after reload', async ({
  signedInPage: page,
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await watchVideo(viewer, video);
  await video.row.locator('.manage-button').click();
  await expect(page.locator('#importTitleInput')).toHaveValue(video.title);
  const description = uniqueName('viewer description café & <plain text>');
  await page.locator('#importDescriptionInput').fill(description);
  const saved = clientResponse(page, `/videos/${video.id}/data`);
  await page.locator('.swal2-confirm').click();
  await expectSuccess(saved);
  await viewer.reload();
  await expect(viewer.locator('#video-information-description')).toHaveText(description);
});

test('viewer comments and replies persist and can be moderated through Client', async ({
  signedInPage: page,
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await watchVideo(viewer, video);
  const text = uniqueName('comment café plain text');
  const id = await postComment(
    viewer,
    video,
    text.replace('plain text', '<b>plain text</b>'),
    text
  );
  await expect(viewer.locator(`#m${id} b`)).toHaveCount(0);
  await viewer.locator(`#pc${id} .comment-quote-button:visible`).first().click();
  const form = viewer.locator(`#comment-input-form-dynamic-${id}`);
  const textarea = form.locator('textarea');
  await expect(textarea).toHaveValue(new RegExp(`>>${id}`));
  const reply = uniqueName('reply');
  await textarea.fill(`${await textarea.inputValue()}\n${reply}`);
  const sent = clientResponse(viewer, `/videos/${video.id}/comments/comment`);
  await form.getByRole('button', { name: 'submit', exact: true }).click();
  await expectSuccess(sent);
  await viewer.reload();
  await openComments(viewer);
  await expect(viewer.locator('#comments-container')).toContainText(text);
  await expect(viewer.locator('#comments-container')).toContainText(reply);
  await page.goto('/comments');
  const searched = clientResponse(page, '/comments/search', 'GET');
  await page.locator('#search-input').fill(text);
  await expectSuccess(searched);
  const row = page.locator('#comments-table tbody tr').filter({
    has: page.locator(`.delete-comment-button[data-commentid="${id}"]`),
  });
  await expect(row).toHaveCount(1);
  await row.locator('.delete-comment-button').click();
  await page.locator('.swal2-cancel').click();
  await expect(page.locator('.swal2-container')).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await row.locator('.delete-comment-button').click();
  const deleted = clientResponse(page, '/comments/delete');
  await page.locator('.swal2-confirm').click();
  await expectSuccess(deleted);
  await expect(row).toHaveCount(0);
  await viewer.reload();
  await openComments(viewer);
  await expect(viewer.locator(`#m${id}`)).toHaveCount(0);
  await expect(viewer.locator('#comments-container')).toContainText(reply);
});

test('sanitized Node comments containing ampersands remain searchable through Client', async ({
  signedInPage: page,
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await watchVideo(viewer, video);
  const text = uniqueName('comment café & searchable text');
  const id = await postComment(
    viewer,
    video,
    text.replace('searchable text', '<b>searchable text</b>'),
    text
  );
  await page.goto('/comments');
  const searched = clientResponse(page, '/comments/search', 'GET');
  await page.locator('#search-input').fill(text);
  await expectSuccess(searched);
  await expect(page.locator(`.delete-comment-button[data-commentid="${id}"]`)).toBeVisible();
});

for (const reaction of ['like', 'dislike']) {
  test(`Node ${reaction} persists after reload for Client-created content`, async ({
    publishedVideo: video,
    viewerPage: viewer,
  }) => {
    await watchVideo(viewer, video);
    const count = viewer.locator(`#video-${reaction}-count`);
    const original = Number(await count.innerText());
    const response = clientResponse(viewer, `/videos/${video.id}/${reaction}`);
    await viewer.locator(`#video-${reaction}-button`).click();
    await expectSuccess(response);
    await expect(count).toHaveText(String(original + 1));
    await viewer.reload();
    await expect(count).toHaveText(String(original + 1));
  });
}

for (const permission of ['comments', 'likes', 'dislikes', 'reports']) {
  test(`Client ${permission} permission is enforced by Node and can be re-enabled`, async ({
    signedInPage: page,
    publishedVideo: video,
    viewerPage: viewer,
  }) => {
    await watchVideo(viewer, video);
    // Keep the viewer open while the owner revokes permission: its stale controls
    // must still receive a real server rejection, independently of disabled UI.
    await setVideoPermission(page, video, permission, false);
    let pathname: string;
    if (permission === 'comments') {
      await openComments(viewer);
      await viewer.locator('#comment-input-form-static textarea').fill(uniqueName('blocked'));
      pathname = `/videos/${video.id}/comments/comment`;
    } else if (permission === 'reports') {
      await viewer.locator('#overflow-dropdown-button').click();
      await viewer.locator('#video-report-button').click();
      await viewer.locator('#report-message-textarea').fill(uniqueName('blocked report'));
      await viewer.locator('#report-email-input').fill('e2e@example.test');
      await viewer.locator('#report-other').check();
      pathname = `/videos/${video.id}/report`;
    } else {
      pathname = `/videos/${video.id}/${permission === 'likes' ? 'like' : 'dislike'}`;
    }
    const rejected = clientResponse(viewer, pathname);
    if (permission === 'comments') {
      await viewer.locator('#comment-input-form-static button[type="submit"]').click();
    } else if (permission === 'reports') {
      await viewer.locator('.swal2-confirm').click();
    } else {
      await viewer.locator(`#video-${permission === 'likes' ? 'like' : 'dislike'}-button`).click();
    }
    expect(await (await rejected).json()).toMatchObject({ isError: true });
    await expect(viewer.locator('.swal2-popup')).toBeVisible();
    if (permission === 'comments') {
      await expect(viewer.locator('#comments-container .postMessage')).toHaveCount(0);
    } else if (permission === 'likes' || permission === 'dislikes') {
      await expect(
        viewer.locator(`#video-${permission === 'likes' ? 'like' : 'dislike'}-count`)
      ).toHaveText('0');
    }
    await viewer.reload();
    if (permission === 'comments') {
      await openComments(viewer);
      await expect(viewer.locator('#comment-input-form-static textarea')).toBeDisabled();
      await expect(
        viewer.locator('#comment-input-form-static button[type="submit"]')
      ).toBeDisabled();
    } else if (permission === 'reports') {
      await viewer.locator('#overflow-dropdown-button').click();
      await expect(viewer.locator('#video-report-button')).toHaveAttribute('aria-disabled', 'true');
    } else {
      await expect(
        viewer.locator(`#video-${permission === 'likes' ? 'like' : 'dislike'}-button`)
      ).toBeDisabled();
    }
    await setVideoPermission(page, video, permission, true);
    await viewer.reload();
    if (permission === 'comments') {
      await postComment(viewer, video, uniqueName('allowed'));
    } else if (permission === 'reports') {
      await viewer.locator('#overflow-dropdown-button').click();
      await viewer.locator('#video-report-button').click();
      const message = uniqueName('allowed report');
      await submitReport(viewer, pathname, message, 'other');
      await page.goto('/reports/videos');
      const row = await tableRow(page, '#video-reports-table', message);
      const deleted = clientResponse(page, '/reports/videos/delete');
      await row.locator('.delete-report-button').click();
      await expectSuccess(deleted);
    } else {
      const allowed = clientResponse(viewer, pathname);
      await viewer.locator(`#video-${permission === 'likes' ? 'like' : 'dislike'}-button`).click();
      await expectSuccess(allowed);
    }
  });
}

for (const kind of ['videos', 'comments']) {
  for (const category of ['complaint', 'copyright', 'other']) {
    for (const action of ['archive', 'delete']) {
      test(`Node ${kind} ${category} report reaches Client for ${action}`, async ({
        signedInPage: page,
        publishedVideo: video,
        viewerPage: viewer,
      }) => {
        await watchVideo(viewer, video);
        const commentId =
          kind === 'comments'
            ? await postComment(viewer, video, uniqueName('reported comment'))
            : null;
        if (commentId) {
          await viewer.locator(`#comment-${commentId}-dropdown-button`).click();
          await viewer.locator(`.comment-report-button[data-comment-id="${commentId}"]`).click();
        } else {
          await viewer.locator('#overflow-dropdown-button').click();
          await viewer.locator('#video-report-button').click();
        }
        const pathname = commentId ? `/comments/${commentId}/report` : `/videos/${video.id}/report`;
        const table = kind === 'videos' ? 'video' : 'comment';
        const message = uniqueName(`${kind} ${category}`);
        await submitReport(viewer, pathname, message, category);
        await page.goto(`/reports/${kind}`);
        const row = await tableRow(page, `#${table}-reports-table`, message);
        await expect(row).toContainText(video.id);
        await expect(row).toContainText('e2e@example.test');
        await expect(row).toContainText(category);
        const changed = clientResponse(page, `/reports/${kind}/${action}`);
        await row
          .locator(action === 'archive' ? '.archive-report-button' : '.delete-report-button')
          .click();
        await expectSuccess(changed);
        await expect(row).toHaveCount(0);
        await page.reload();
        await page
          .locator('.dataTable-wrapper')
          .filter({ has: page.locator(`#${table}-reports-table`) })
          .locator('.dataTable-search input')
          .fill(message);
        await expect(page.locator(`#${table}-reports-table`)).not.toContainText(message);
        if (action === 'archive') {
          const archive = await tableRow(page, `#${table}-reports-archive-table`, message);
          const removed = clientResponse(page, `/reports/${kind}/archive/delete`);
          await archive.locator('.delete-archive-button').click();
          await expectSuccess(removed);
          await expect(archive).toHaveCount(0);
          await page.reload();
          await page
            .locator('.dataTable-wrapper')
            .filter({ has: page.locator(`#${table}-reports-archive-table`) })
            .locator('.dataTable-search input')
            .fill(message);
          await expect(page.locator(`#${table}-reports-archive-table`)).not.toContainText(message);
        }
      });
    }
  }
}

for (const kind of ['videos', 'comments']) {
  test(`Node accepts a ${kind} report with the optional email left blank`, async ({
    signedInPage: page,
    publishedVideo: video,
    viewerPage: viewer,
  }) => {
    await watchVideo(viewer, video);
    const id =
      kind === 'comments' ? await postComment(viewer, video, uniqueName('optional email')) : null;
    if (id) {
      await viewer.locator(`#comment-${id}-dropdown-button`).click();
      await viewer.locator(`.comment-report-button[data-comment-id="${id}"]`).click();
    } else {
      await viewer.locator('#overflow-dropdown-button').click();
      await viewer.locator('#video-report-button').click();
    }
    await expect(viewer.locator('#report-email-input')).toHaveAttribute(
      'placeholder',
      'email (optional)'
    );
    const message = uniqueName('no email');
    await submitReport(
      viewer,
      id ? `/comments/${id}/report` : `/videos/${video.id}/report`,
      message,
      'other',
      ''
    );
    await page.goto(`/reports/${kind}`);
    const row = await tableRow(
      page,
      kind === 'videos' ? '#video-reports-table' : '#comment-reports-table',
      message
    );
    const deleted = clientResponse(page, `/reports/${kind}/delete`);
    await row.locator('.delete-report-button').click();
    await expectSuccess(deleted);
  });
}

test('unpublishing through Client removes the playable source on Node', async ({
  signedInPage: page,
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await watchVideo(viewer, video);
  await video.row.locator('.manage-button').click();
  const loaded = clientResponse(page, `/videos/${video.id}/publishes`, 'GET');
  await page.getByRole('tab', { name: 'Published', exact: true }).click();
  await expectSuccess(loaded);
  await page.getByRole('tab', { name: 'MP4', exact: true }).click();
  const checkbox = page.locator(`[id="${video.id}_mp4_240p_publish_checkbox"]`);
  await expect(checkbox).toBeChecked();
  const response = clientResponse(page, `/videos/${video.id}/unpublish`);
  await checkbox.uncheck();
  await expectSuccess(response);
  await viewer.reload();
  await expect(viewer.locator('#video-player-container')).toContainText(
    /unavailable|not.*published/i
  );
  await expect(viewer.locator('video source')).toHaveCount(0);
});

test('Node viewer theme preference survives reload without affecting Client login', async ({
  publishedVideo: video,
  viewerPage: viewer,
  signedInPage: page,
}) => {
  await watchVideo(viewer, video);
  await viewer.locator('#navbar-settings-button').click();
  const toggle = viewer.locator('#darkModeSwitch');
  await toggle.check();
  await viewer.reload();
  await viewer.locator('#navbar-settings-button').click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('#import-button')).toBeVisible();
});

test('Node playback controls change speed, format and theater layout', async ({
  signedInPage: page,
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await publishVideo(page, video, 'webm');
  await watchVideo(viewer, video);
  await expectPlayback(viewer);
  await viewer.locator('#video-player').hover();
  const settings = viewer.locator('.mt-settings');
  await settings.click();
  await viewer.getByRole('menuitem', { name: /^Playback speed/ }).click();
  await viewer.getByRole('menuitemradio', { name: '1.5×', exact: true }).click();
  await expect
    .poll(() =>
      viewer.locator('video').evaluate((element) => (element as HTMLVideoElement).playbackRate)
    )
    .toBe(1.5);
  await viewer.getByRole('menuitem', { name: '‹ Playback speed', exact: true }).click();
  await viewer.getByRole('menuitem', { name: /^Quality/ }).click();
  await viewer.getByRole('menuitem', { name: /^webm/ }).click();
  await viewer.getByRole('menuitemradio', { name: '240p', exact: true }).click();
  await expect
    .poll(() =>
      viewer.locator('video').evaluate((element) => (element as HTMLVideoElement).currentSrc)
    )
    .toContain('.webm');
  await viewer.locator('#video-title').click();
  await expectPlayback(viewer);
  await viewer.locator('#video-player').hover();
  await viewer.getByRole('button', { name: 'Theater mode', exact: true }).click();
  await expect(viewer.locator('#theater-container #video-player')).toBeVisible();
  await viewer.locator('#video-player').hover();
  await viewer.getByRole('button', { name: 'Theater mode', exact: true }).click();
  await expect(viewer.locator('#video-comments-inner #video-player')).toBeVisible();
});

test('Node comment refresh loads a comment submitted from another viewer page', async ({
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await watchVideo(viewer, video);
  await openComments(viewer);
  const other = await viewer.context().newPage();
  await watchVideo(other, video);
  const message = uniqueName('refresh comment');
  const id = await postComment(other, video, message);
  await viewer.locator('#update-comments-button').click();
  await expect(viewer.locator(`#m${id}`)).toHaveText(message);
  await expect(viewer.locator('#comment-section-counter')).toHaveText('1');
});

test('Node viewer can comment and share at a narrow viewport', async ({
  publishedVideo: video,
  viewerPage: viewer,
}) => {
  await viewer.setViewportSize({ width: 390, height: 844 });
  await watchVideo(viewer, video);
  await postComment(viewer, video, uniqueName('mobile comment'));
  await viewer.locator('#comment-section-back-button').click();
  await expect(viewer.locator('#expand-comment-section')).toBeVisible();
  await viewer.locator('#video-share-button').click();
  await expect(viewer.locator('#node-video-url-input')).toHaveValue(
    new RegExp(`watch\\?v=${video.id}`)
  );
});
