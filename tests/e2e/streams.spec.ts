import {
  expect,
  uniqueName,
  clientResponse,
  expectSuccess,
  closeDialog,
  deleteVideo,
} from './fixtures.js';
import { test, watchVideo, expectPlayback } from './node-fixtures.js';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpegBinaries } from '../../src/utils/ffmpeg-path.js';

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
]) {
  test(`recording switches work at ${viewport.width}x${viewport.height}`, async ({
    signedInPage: page,
  }) => {
    await page.setViewportSize(viewport);
    await page.locator('#live-button').click();
    const dialog = await page.locator('.swal2-popup').boundingBox();
    expect(dialog).not.toBeNull();
    expect(dialog!.x).toBeGreaterThanOrEqual(0);
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(viewport.width);
    for (const kind of ['Remotely', 'Locally']) {
      const checkbox = page.locator(`#recordStream${kind}Checkbox`);
      await checkbox.check();
      await expect(checkbox).toBeChecked();
      await page.locator(`label[for="recordStream${kind}Checkbox"]`).click();
      await expect(checkbox).not.toBeChecked();
      await checkbox.focus();
      await checkbox.press('Space');
      await expect(checkbox).toBeChecked();
    }
    await closeDialog(page);
  });
}

test('live dialog discovers real network addresses and validates required fields', async ({
  signedInPage: page,
}) => {
  await page.locator('#live-button').click();
  await expect(page.locator('#liveNetworkAddressSelect option')).not.toHaveCount(0);
  await expect(page.locator('#streamResolution240p')).toBeVisible();
  await expect(page.locator('#recordStreamRemotelyCheckbox')).toBeVisible();
  await expect(page.locator('#recordStreamLocallyCheckbox')).toBeVisible();
  await page.locator('.swal2-confirm').click();
  await expect(page.locator('.swal2-validation-message')).toContainText('enter a title');
});

test.describe(() => {
  test.skip(
    ({ browserName }) => browserName === 'webkit' && process.platform !== 'darwin',
    'WebKit live HLS playback is restricted to macOS.'
  );

  test('starts and stops a real RTMP stream through the Client UI', async ({
    signedInPage: page,
    viewerPage: viewer,
  }) => {
    test.setTimeout(150_000);
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve()))
    );
    const title = uniqueName('live');
    await page.locator('#live-button').click();
    await page.locator('#importTitleInput').fill(title);
    await page
      .locator('#importDescriptionInput')
      .fill('Real RTMP input for the Client live workflow');
    await page.locator('.swal2-popup .choices__input--cloned').fill('e2e');
    await page.locator('.swal2-popup .choices__input--cloned').press('Enter');
    await page.locator('#rtmpPortInput').fill(String(port));
    await page.locator('#streamResolution240p').check();
    await page.locator('#recordStreamRemotelyCheckbox').check();
    await page.locator('#recordStreamLocallyCheckbox').check();
    await expect(page.locator('#liveNetworkAddressSelect option')).not.toHaveCount(0);
    const started = clientResponse(page, '/streams/start');
    await page.locator('.swal2-confirm').click();
    await expectSuccess(started);
    const { rtmpUrl } = (await (await started).json()) as { rtmpUrl: string };
    expect(rtmpUrl).toMatch(/^rtmp:\/\//);
    const broadcast = promisify(execFile)(
      resolveFfmpegBinaries().ffmpeg,
      [
        '-re',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=426x240:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '40',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-threads',
        '2',
        '-c:a',
        'aac',
        '-f',
        'flv',
        rtmpUrl,
      ],
      { timeout: 55_000 }
    ).then(
      () => null,
      (error: unknown) => error
    );
    // The sender is a real broadcaster providing input, not a replacement for Client processing.
    const row = page.locator('#videos_table tbody tr').filter({ hasText: title });
    let streamStopped = false;
    let workflowFailed = false;
    let workflowError: unknown;
    let cleanupFailed = false;
    let cleanupError: unknown;
    const stopTestStream = async (): Promise<void> => {
      // A viewer assertion must not leave a recording/publishing job running
      // while the next test signs out and replaces the Client's Node socket.
      await page.bringToFront();
      await closeDialog(page);
      await expect(row).toHaveCount(1);
      const id = await row.locator('.videos-table-select-video').getAttribute('data-videoid');
      if (!id) {
        throw new Error('Cannot stop the test stream: its Client row has no video ID');
      }
      const stop = row.locator('.streaming-job-stop');
      if (await stop.isVisible()) {
        const stopped = clientResponse(page, `/streams/${id}/stop`);
        await stop.click();
        await expectSuccess(stopped);
      }
      await expect(row).toContainText('streamed', { timeout: 20_000 });
      await expect(stop).toHaveCount(0);
      await test.info().attach('stream-cleanup.json', {
        body: JSON.stringify({ videoId: id, state: 'streamed', stopControlRemoved: true }),
        contentType: 'application/json',
      });
    };
    try {
      await expect(row).toHaveCount(1);
      await expect(row.locator('.streaming-job-stop')).toBeVisible({ timeout: 20_000 });
      await expect(row.locator('td').nth(1)).toContainText(/00:00:(0[1-9]|[1-5]\d)/, {
        timeout: 25_000,
      });
      const id = await row.locator('.videos-table-select-video').getAttribute('data-videoid');
      if (!id) {
        throw new Error('Live video ID missing from Client table');
      }
      await row.locator('.rtmp-links-button').click();
      await expect(page.locator('#rtmp-url-input')).toHaveValue(rtmpUrl);
      await closeDialog(page);
      const video = { id, title, row };
      await watchVideo(viewer, video);
      await expect(viewer.locator('#send-chat-message-input')).toBeEnabled();
      // A second Node page must receive the message over its own real WebSocket.
      const observer = await viewer.context().newPage();
      await watchVideo(observer, video);
      await expect(observer.locator('#send-chat-message-input')).toBeEnabled();
      const message = uniqueName('live chat');
      await viewer.locator('#send-chat-message-input').fill(message);
      await viewer.locator('#send-chat-message-button').click();
      await expect(observer.locator('#chat-messages')).toContainText(message);
      await expect(observer.locator('.chat-message').filter({ hasText: message })).toHaveCount(1);
      await expect(viewer.locator('.pending-chat-message')).toHaveCount(0);
      await expect(viewer.locator('.chat-message').filter({ hasText: message })).toHaveCount(1);
      await observer.reload();
      await expect(observer.locator('#chat-messages')).toContainText(message);
      await expectPlayback(viewer);
      const stopped = clientResponse(page, `/streams/${id}/stop`);
      await row.locator('.streaming-job-stop').click();
      await expectSuccess(stopped);
      streamStopped = true;
      await expect(row).toContainText('streamed', { timeout: 20_000 });
      await viewer.reload();
      await expect(viewer.locator('#live-stream-chat-container')).toBeHidden();
      await deleteVideo(page, video);
    } catch (error) {
      workflowFailed = true;
      workflowError = error;
    } finally {
      try {
        if (!streamStopped) {
          await stopTestStream();
        }
      } catch (error) {
        await test.info().attach('stream-cleanup-error.txt', {
          body: String(error),
          contentType: 'text/plain',
        });
        cleanupFailed = true;
        cleanupError = error;
      } finally {
        // The real sender exits when Client stops its RTMP receiver. Always reap it.
        await broadcast;
      }
    }
    if (workflowFailed) {
      throw workflowError;
    }
    if (cleanupFailed) {
      throw cleanupError;
    }
  });
});
