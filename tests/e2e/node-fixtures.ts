import type { Page, Locator } from '@playwright/test';
import {
  test as clientTest,
  expect,
  type ImportedVideo,
  clientResponse,
  expectSuccess,
  closeDialog,
} from './fixtures.js';
import { NODE_URL } from './support/check-node.js';

export async function publishVideo(
  page: Page,
  video: ImportedVideo,
  format = 'mp4'
): Promise<void> {
  await video.row.locator('.publish-wizard-button').click();
  const checkbox = page.locator(`[id="${video.id}_${format}_240p_publish_checkbox"]`);
  await checkbox.check();
  const response = clientResponse(page, `/videos/${video.id}/publish`);
  await page.locator('.swal2-confirm').click();
  await expectSuccess(response);
  await expect(checkbox).toHaveClass(/form-check-input-is-published/, { timeout: 120_000 });
  await closeDialog(page);
}

export async function watchVideo(viewer: Page, video: ImportedVideo): Promise<void> {
  const url = new URL('/watch', NODE_URL);
  url.searchParams.set('v', video.id);
  const response = await viewer.goto(url.toString());
  expect(response?.status(), 'The real Node must serve the Client-created video').toBe(200);
  await expect(viewer.locator('#video-title')).toHaveText(video.title);
}

export async function expectPlayback(viewer: Page, playbackRequested = false): Promise<void> {
  const media = viewer.locator('video');
  if (
    !playbackRequested &&
    (await media.evaluate((element) => (element as HTMLVideoElement).paused))
  ) {
    const poster = viewer.locator('#big-play-button-poster-container');
    if (await poster.isVisible()) {
      await poster.click();
    } else {
      await viewer.locator('#video-player').hover();
      await viewer.locator('.vjs-play-control').click();
    }
  }
  await expect
    .poll(() => media.evaluate((element) => (element as HTMLVideoElement).currentTime), {
      message: 'The browser must actually decode and play the published media',
      timeout: 30_000,
    })
    .toBeGreaterThan(0.2);
  expect(
    await media.evaluate((element) => (element as HTMLVideoElement).videoWidth)
  ).toBeGreaterThan(0);
  expect(await media.evaluate((element) => (element as HTMLVideoElement).error)).toBeNull();
}

export async function openComments(viewer: Page): Promise<void> {
  const expand = viewer.locator('#expand-comment-section');
  if (await expand.isVisible()) {
    await expand.click();
  }
  await expect(viewer.locator('#comment-input-form-static textarea')).toBeVisible();
}

export async function postComment(
  viewer: Page,
  video: ImportedVideo,
  text: string,
  expectedText = text
): Promise<string> {
  await openComments(viewer);
  const form = viewer.locator('#comment-input-form-static');
  await form.locator('textarea').fill(text);
  const response = clientResponse(viewer, `/videos/${video.id}/comments/comment`);
  await form.getByRole('button', { name: 'submit', exact: true }).click();
  await expectSuccess(response);
  const { commentId } = (await (await response).json()) as { commentId: number };
  expect(Number.isInteger(commentId)).toBe(true);
  await expect(viewer.locator(`#m${commentId}`)).toContainText(expectedText);
  return String(commentId);
}

export async function setVideoPermission(
  page: Page,
  video: ImportedVideo,
  permission: string,
  enabled: boolean
): Promise<void> {
  await video.row.locator('.manage-button').click();
  const loaded = clientResponse(page, `/videos/${video.id}/permissions`, 'GET');
  await page.locator('.moving-tab-selector-1[data-type="permissions"]').click();
  await expectSuccess(loaded);
  const checkbox = page.locator(`#manage-modal-permissions-${permission}-checkbox`);
  if ((await checkbox.isChecked()) !== enabled) {
    const saved = clientResponse(page, `/videos/${video.id}/permissions`);
    await checkbox.setChecked(enabled);
    await expectSuccess(saved);
  }
  await closeDialog(page);
}

export async function tableRow(page: Page, table: string, text: string): Promise<Locator> {
  const wrapper = page.locator('.dataTable-wrapper').filter({ has: page.locator(table) });
  await wrapper.locator('.dataTable-search input').fill(text);
  const row = page.locator(`${table} tbody tr`).filter({ hasText: text });
  await expect(row).toHaveCount(1);
  return row;
}

export async function submitReport(
  viewer: Page,
  pathname: string,
  message: string,
  category: string,
  email = 'e2e@example.test'
): Promise<void> {
  await viewer.locator('#report-message-textarea').fill(message);
  await viewer.locator('#report-email-input').fill(email);
  await viewer.locator(`#report-${category}`).check();
  const response = clientResponse(viewer, pathname);
  await viewer.locator('.swal2-confirm').click();
  await expectSuccess(response);
  await expect(viewer.locator('.swal2-popup')).toBeHidden();
}

export const test = clientTest.extend<{ viewerPage: Page; publishedVideo: ImportedVideo }>({
  viewerPage: async ({ browser }, use, testInfo) => {
    // Viewer sessions never inherit the Client administrator's cookies or authentication.
    const context = await browser.newContext({
      baseURL: NODE_URL,
      recordVideo: { dir: testInfo.outputPath('viewer-videos') },
    });
    const errors: string[] = [];
    const socketEvents: Record<string, unknown>[] = [];
    let nextSocketId = 0;
    context.on('page', (page) => {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('websocket', (socket) => {
        const socketId = nextSocketId++;
        const recordFrame = (direction: string, payload: string | Buffer): void => {
          try {
            const data: unknown = JSON.parse(payload.toString());
            if (typeof data !== 'object' || data === null) {
              return;
            }
            const fields = Object.fromEntries(
              [
                'eventName',
                'type',
                'videoId',
                'chatMessageContent',
                'sentTimestamp',
                'liveChatUsername',
                'liveChatUsernameColorCode',
                'errorType',
                'message',
              ]
                .filter((key) => key in data)
                .map((key) => [key, (data as Record<string, unknown>)[key]])
            );
            socketEvents.push({
              time: Date.now(),
              socketId,
              page: page.url(),
              direction,
              ...fields,
            });
          } catch {
            // Diagnostics record only JSON protocol fields, never tokens or raw frames.
          }
        };
        socket.on('framesent', ({ payload }) => recordFrame('sent', payload));
        socket.on('framereceived', ({ payload }) => recordFrame('received', payload));
      });
    });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus || errors.length > 0;
      try {
        if (failed) {
          await testInfo.attach('node-websocket-events.json', {
            body: JSON.stringify(socketEvents, null, 2),
            contentType: 'application/json',
          });
          await testInfo.attach('node-browser-errors.json', {
            body: JSON.stringify(errors, null, 2),
            contentType: 'application/json',
          });
          const media = await Promise.all(
            context.pages().map(async (item) => ({
              url: item.url(),
              players: await item.locator('video').evaluateAll((elements) =>
                elements.map((node) => {
                  const element = node as HTMLVideoElement;
                  return {
                    currentSrc: element.currentSrc,
                    currentTime: element.currentTime,
                    videoWidth: element.videoWidth,
                    videoHeight: element.videoHeight,
                    ended: element.ended,
                    readyState: element.readyState,
                    networkState: element.networkState,
                    paused: element.paused,
                    error: element.error && {
                      code: element.error.code,
                      message: element.error.message,
                    },
                    supportedTypes: {
                      mp4: element.canPlayType('video/mp4; codecs="avc1.42E01E"'),
                      webm: element.canPlayType('video/webm; codecs="vp9, opus"'),
                      hls: element.canPlayType('application/vnd.apple.mpegurl'),
                    },
                  };
                })
              ),
            }))
          );
          await testInfo.attach('node-media-state.json', {
            body: JSON.stringify(media, null, 2),
            contentType: 'application/json',
          });
          if (!page.isClosed()) {
            await testInfo.attach('node-viewer.png', {
              body: await page.screenshot(),
              contentType: 'image/png',
            });
          }
        }
      } catch (error) {
        await testInfo.attach('node-diagnostics-error.txt', {
          body: String(error),
          contentType: 'text/plain',
        });
      } finally {
        const recordings = context.pages().map((item) => item.video());
        await context.close();
        for (const video of recordings) {
          if (video) {
            if (failed) {
              await testInfo.attach('node-video', {
                path: await video.path(),
                contentType: 'video/webm',
              });
            } else {
              await video.delete();
            }
          }
        }
      }
      expect(errors, 'Uncaught exceptions in the real Node viewer UI').toEqual([]);
    }
  },
  publishedVideo: async ({ signedInPage: page, importedVideo: video }, use) => {
    await publishVideo(page, video);
    await use(video);
  },
});
export { expect };
