import {
  test,
  expect,
  watchVideo,
  postComment,
  tableRow,
  submitReport,
  publishVideo,
} from './node-fixtures.js';
import {
  uniqueName,
  clientResponse,
  expectSuccess,
  createMedia,
  importVideo,
  deleteVideo,
} from './fixtures.js';

test.beforeEach(() => {
  test.setTimeout(180_000);
});

for (const kind of ['videos', 'comments']) {
  test(`Client deletes reported ${kind} and Node reflects the moderation`, async ({
    signedInPage: page,
    viewerPage: viewer,
  }, testInfo) => {
    const file = testInfo.outputPath('moderation.mp4');
    await createMedia(file);
    const video = await importVideo(page, file);
    await publishVideo(page, video);
    await watchVideo(viewer, video);
    const commentId =
      kind === 'comments' ? await postComment(viewer, video, uniqueName('moderated')) : null;
    if (commentId) {
      await viewer.locator(`#comment-${commentId}-dropdown-button`).click();
      await viewer.locator(`.comment-report-button[data-comment-id="${commentId}"]`).click();
    } else {
      await viewer.locator('#overflow-dropdown-button').click();
      await viewer.locator('#video-report-button').click();
    }
    const message = uniqueName('moderate report');
    await submitReport(
      viewer,
      commentId ? `/comments/${commentId}/report` : `/videos/${video.id}/report`,
      message,
      'other'
    );
    await page.goto(`/reports/${kind}`);
    const table = kind === 'videos' ? '#video-reports-table' : '#comment-reports-table';
    const row = await tableRow(page, table, message);
    await row.locator(commentId ? '.delete-comment-button' : '.delete-video-button').click();
    const removed = clientResponse(page, commentId ? '/comments/delete' : '/videos/delete');
    await page.locator('.swal2-confirm').click();
    await expectSuccess(removed);
    if (commentId) {
      await viewer.reload();
      await expect(viewer.locator(`#m${commentId}`)).toHaveCount(0);
      await expect(viewer.locator('#video-title')).toHaveText(video.title);
    } else {
      expect((await viewer.reload())?.status()).toBe(404);
    }
    // Reports have their own lifecycle; remove only the report made by this test.
    await page.reload();
    const remaining = await tableRow(page, table, message);
    const deleted = clientResponse(page, `/reports/${kind}/delete`);
    await remaining.locator('.delete-report-button').click();
    await expectSuccess(deleted);
    if (commentId) {
      await deleteVideo(page, video);
    }
  });
}
