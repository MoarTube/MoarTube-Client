import { test as base, expect } from '@playwright/test';
import type { Page, Locator, Response } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpegBinaries } from '../../src/utils/ffmpeg-path.js';
import checkNode from './support/check-node.js';
import { readClientLogTail } from './support/client-logs.js';

export const credentials = {
  username: process.env['MOARTUBE_E2E_USERNAME'] || 'admin',
  password: process.env['MOARTUBE_E2E_PASSWORD'] || 'admin',
};
export const uniqueName = (prefix: string): string => `E2E ${prefix} ${randomUUID()}`;

// Keep the original rejection for the eventual await. If an earlier UI action
// fails, the abandoned observer must not become an unrelated unhandled rejection.
export function observe<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}

export async function signIn(page: Page, password = credentials.password): Promise<void> {
  await page.goto('/account/signout');
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await page.getByPlaceholder('Username', { exact: true }).fill(credentials.username);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
  await page.getByPlaceholder('ip address', { exact: true }).fill('localhost');
  await page.getByPlaceholder('port', { exact: true }).fill('9090');
  await page.locator('#sign-in-button').click();
  if (password === credentials.password) {
    await expect(
      page,
      'Client sign-in must succeed against the real Node on localhost:9090'
    ).toHaveURL(/\/videos\/?$/);
    await expect(page.locator('#import-button')).toBeVisible();
  }
}

// Observe requests initiated by the UI; never submit workflows using an API shortcut.
export function clientResponse(page: Page, pathname: string, method = 'POST'): Promise<Response> {
  return observe(
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === pathname && response.request().method() === method,
      { timeout: 30_000 }
    )
  );
}
export async function expectSuccess(response: Promise<Response>): Promise<void> {
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  expect(await result.json()).toMatchObject({ isError: false });
}
export async function closeDialog(page: Page): Promise<void> {
  const close = page.locator('.swal2-close:visible');
  if (await close.count()) {
    await close.click();
  }
  await expect(page.locator('.swal2-popup')).toBeHidden();
  await expect(page.locator('.swal2-container')).toHaveCount(0);
}

export async function createMedia(
  file: string,
  options: { extension?: 'mp4' | 'webm'; seconds?: number; size?: string; silent?: boolean } = {}
): Promise<void> {
  const extension = options.extension ?? 'mp4';
  const args = ['-f', 'lavfi', '-i', `testsrc2=size=${options.size ?? '426x240'}:rate=30`];
  if (!options.silent) {
    args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
  }
  args.push(
    '-t',
    String(options.seconds ?? 2),
    '-c:v',
    extension === 'mp4' ? 'libx264' : 'libvpx-vp9',
    '-threads',
    '2'
  );
  if (extension === 'mp4') {
    args.push('-preset', 'ultrafast');
  }
  if (!options.silent) {
    args.push('-c:a', extension === 'mp4' ? 'aac' : 'libopus');
  }
  args.push('-y', file);
  await promisify(execFile)(resolveFfmpegBinaries().ffmpeg, args, {
    timeout: 120_000,
  });
}

export interface ImportedVideo {
  id: string;
  title: string;
  row: Locator;
}
export async function searchVideos(page: Page, title: string): Promise<void> {
  const response = observe(
    page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/videos/search' &&
        new URL(result.url()).searchParams.get('searchTerm') === title
    )
  );
  await page.locator('#search-input').fill(title);
  await expectSuccess(response);
}
export async function importVideo(
  page: Page,
  file: string,
  title = uniqueName('video')
): Promise<ImportedVideo> {
  await page.goto('/videos');
  await page.locator('#import-button').click();
  await page.locator('#importTitleInput').fill(title);
  await page
    .locator('#importDescriptionInput')
    .fill('Created by MoarTube Client Playwright through the import dialog.');
  await page.locator('#importVideoFileInput').setInputFiles(file);
  const tags = page.locator('.swal2-popup .choices__input--cloned');
  await tags.fill('e2e');
  await tags.press('Enter');
  const response = observe(
    page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/videos/import' && result.request().method() === 'POST',
      { timeout: 120_000 }
    )
  );
  await page.locator('.swal2-confirm').click();
  await expectSuccess(response);
  await page.reload();
  await searchVideos(page, title);
  const row = page.locator('#videos_table tbody tr').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('imported');
  const id = await row.locator('.videos-table-select-video').getAttribute('data-videoid');
  if (!id) {
    throw new Error('The Client did not render an imported video ID');
  }
  await base.info().attach('created-video.json', {
    body: JSON.stringify({ id, title }),
    contentType: 'application/json',
  });
  return { id, title, row };
}

export async function deleteVideo(page: Page, video: ImportedVideo): Promise<void> {
  await page.goto('/videos');
  await searchVideos(page, video.title);
  const row = page.locator(`#videos_table_row_${video.id}`);
  await expect(row).toBeVisible();
  // Stop only this test's active job through its normal Client control before
  // deleting media that a publisher/streamer could still be using.
  for (const [selector, pathname] of [
    ['.publishing-job-stop', `/videos/${video.id}/publishing/stop`],
    ['.streaming-job-stop', `/streams/${video.id}/stop`],
  ] as const) {
    const stop = row.locator(selector);
    if (await stop.isVisible()) {
      const response = clientResponse(page, pathname);
      await stop.click();
      await expectSuccess(response);
      await expect(stop).toHaveCount(0);
    }
  }
  await row.locator('.videos-table-select-video').check();
  await page.locator('#delete-selected-videos-button').click();
  const response = clientResponse(page, '/videos/delete');
  await page.locator('.swal2-confirm').click();
  await expectSuccess(response);
  await expect(row).toHaveCount(0);
}

export const test = base.extend<
  { signedInPage: Page; importedVideo: ImportedVideo; audit: undefined },
  { nodeReady: undefined }
>({
  nodeReady: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await checkNode();
      await use(undefined);
    },
    { scope: 'worker', auto: true },
  ],
  signedInPage: async ({ page }, use, testInfo) => {
    await signIn(page);
    const gpuId = process.env['MOARTUBE_E2E_GPU_ID'];
    if (gpuId !== undefined && gpuId !== '') {
      await page.goto('/settings');
      const select = page.getByRole('combobox', { name: 'GPU acceleration' });
      await expect(select).toBeEnabled();
      const saved = clientResponse(page, '/settings/client/gpuAcceleration');
      await select.selectOption(gpuId);
      await expectSuccess(saved);
      const result = await (await saved).json();
      expect(result.result.selectedGpuId, 'Client must retain the explicitly requested GPU').toBe(
        gpuId
      );
      await expect(select).toBeEnabled();
      await expect(select).toHaveValue(gpuId);
      await testInfo.attach('required-gpu.json', {
        body: JSON.stringify(result.result),
        contentType: 'application/json',
      });
      await page.goto('/videos');
    }
    await use(page);
  },
  importedVideo: async ({ signedInPage: page }, use, testInfo) => {
    const file = testInfo.outputPath('source.mp4');
    await createMedia(file);
    const video = await importVideo(page, file);
    try {
      await use(video);
    } finally {
      await deleteVideo(page, video);
    }
  },
  audit: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      const failed: { url: string; status: number }[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 500) {
          failed.push({ url: response.url(), status: response.status() });
        }
      });
      await use(undefined);
      if (testInfo.status !== testInfo.expectedStatus || errors.length) {
        try {
          await testInfo.attach('client-process.log', {
            body: await readClientLogTail(),
            contentType: 'text/plain',
          });
        } catch (error) {
          await testInfo.attach('client-log-unavailable.txt', {
            body: `Client log unavailable (an existing Client may have been reused): ${String(error)}`,
            contentType: 'text/plain',
          });
        }
        await testInfo.attach('browser-errors.json', {
          body: JSON.stringify({ errors, failed }, null, 2),
          contentType: 'application/json',
        });
      }
      expect(errors, 'Uncaught exceptions in the real Client UI').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
