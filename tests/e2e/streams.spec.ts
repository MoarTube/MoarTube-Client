import {
  test,
  expect,
  uniqueName,
  clientResponse,
  expectSuccess,
  closeDialog,
  deleteVideo,
} from './fixtures.js';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';

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

test('starts and stops a real RTMP stream through the Client UI', async ({
  signedInPage: page,
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
    (ffmpeg as unknown as string | null) ?? 'ffmpeg',
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
      '20',
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
    { timeout: 35_000 }
  ).then(
    () => null,
    (error: unknown) => error
  );
  // The sender is a real broadcaster providing input, not a replacement for Client processing.
  const row = page.locator('#videos_table tbody tr').filter({ hasText: title });
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
    const stopped = clientResponse(page, `/streams/${id}/stop`);
    await row.locator('.streaming-job-stop').click();
    await expectSuccess(stopped);
    await expect(row).toContainText('streamed', { timeout: 20_000 });
    await deleteVideo(page, { id, title, row });
  } finally {
    // A Client stop normally closes the broadcaster's connection; that exit is expected.
    await broadcast;
  }
});
