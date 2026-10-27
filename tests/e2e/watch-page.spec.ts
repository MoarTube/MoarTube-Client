import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import path from 'node:path';
import ejs from 'ejs';
const root = path.resolve('../MoarTube-Node');
const host = 'http://watch.test',
  id = 'aaaaaaaaaaa';
let mediaFolder: string;
test.beforeAll(async () => {
  mediaFolder = await mkdtemp(path.join(tmpdir(), 'moartube-watch-playback-'));
  await promisify(execFile)(ffmpeg as unknown as string, [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=426x240:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '10',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-threads',
    '2',
    '-g',
    '30',
    '-sc_threshold',
    '0',
    '-c:a',
    'aac',
    '-f',
    'hls',
    '-hls_time',
    '2',
    '-hls_list_size',
    '0',
    '-hls_segment_filename',
    path.join(mediaFolder, 'segment-%d.ts'),
    path.join(mediaFolder, 'fixture.m3u8'),
  ]);
  await promisify(execFile)(ffmpeg as unknown as string, [
    '-i',
    path.join(mediaFolder, 'fixture.m3u8'),
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    path.join(mediaFolder, 'fixture.mp4'),
  ]);
});
test.afterAll(async () => {
  if (
    path.dirname(mediaFolder) !== path.resolve(tmpdir()) ||
    !path.basename(mediaFolder).startsWith('moartube-watch-playback-')
  )
    throw new Error('Unexpected fixture directory');
  await rm(mediaFolder, { recursive: true, force: true });
});
async function fixture(
  page: Page,
  {
    playback = false,
    closed = false,
    malicious = false,
    publishing = false,
    time = 0,
    progressive = false,
  } = {}
) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const title = malicious ? '<img src=x onerror="window.metadataExecuted=true">' : 'Video';
  const text = malicious ? '</script><script>window.metadataExecuted=true</script>' : 'Description';
  const model = {
    externalVideosBaseUrl: host,
    externalResourcesBaseUrl: host,
    informationData: {
      information: {
        nodeName: 'Fixture',
        nodeVideoCount: 1,
        nodeAbout: text,
        publicNodeProtocol: 'http',
        publicNodeAddress: 'watch.test',
        publicNodePort: '80',
        cloudflareTurnstileSiteKey: '',
      },
    },
    linksData: { links: [] },
    cryptoWalletAddressesData: { cryptoWalletAddresses: [] },
    commentsData: {
      totalCount: 1,
      hasMore: false,
      cacheEpoch: '11111111-1111-4111-8111-111111111111',
      cacheVersion: 1,
      cdnEnabled: false,
    },
    videoData: {
      video: {
        videoId: id,
        title,
        description: text,
        tags: 'test',
        views: 1,
        likes: 1,
        dislikes: 1,
        comments: 1,
        isPublished: !publishing,
        isPublishing: publishing,
        isLive: false,
        isStreamed: false,
        isStreaming: false,
        isLikesEnabled: !closed,
        isDislikesEnabled: !closed,
        isReportsEnabled: !closed,
        isCommentsEnabled: !closed,
        isLiveChatEnabled: !closed,
        creationTimestamp: Date.now(),
        adaptiveSources:
          playback && !progressive
            ? [
                {
                  src:
                    host +
                    `/external/videos/${id}/adaptive/m3u8/static/manifests/manifest-master.m3u8`,
                  type: 'application/x-mpegURL',
                },
                {
                  src:
                    host +
                    `/external/videos/${id}/adaptive/m3u8/static/manifests/manifest-720p.m3u8`,
                  type: 'application/x-mpegURL',
                },
              ]
            : [],
        progressiveSources:
          playback && progressive
            ? [{ src: host + `/external/videos/${id}/progressive/mp4/240p.mp4`, type: 'video/mp4' }]
            : [],
        sourcesFormatsAndResolutions: {
          m3u8: playback ? ['720p'] : [],
          mp4: [],
          webm: [],
          ogv: [],
        },
      },
    },
    recommendedVideosData: {
      recommendedVideos: [
        {
          videoId: 'bbbbbbbbbbb',
          title,
          tags: malicious ? title + ',__proto__,hasOwnProperty' : 'test',
          views: 1,
          lengthSeconds: 15,
          isLive: false,
          isStreaming: false,
          creationTimestamp: Date.now(),
        },
      ],
    },
  };
  let html = ejs.render(await readFile(path.join(root, 'public/views/watch.ejs'), 'utf8'), {
    model,
  });
  html = html.replace(
    'const moarTubeWatch = new MoarTubeWatch();',
    'const moarTubeWatch = window.watchFixture = new MoarTubeWatch();'
  );
  const mediaRequests: string[] = [];
  const documentRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'watch.test')
      return route.fulfill({ body: '', contentType: 'application/javascript' });
    if (url.pathname === '/watch') {
      documentRequests.push(route.request().url());
      return route.fulfill({ body: html, contentType: 'text/html' });
    }
    if (url.pathname.startsWith('/external/resources/')) {
      const parts = url.pathname.split('/').slice(3);
      const file = path.join(root, 'public', ...parts);
      try {
        return route.fulfill({
          body: await readFile(file),
          contentType: file.endsWith('.js')
            ? 'application/javascript'
            : file.endsWith('.css')
              ? 'text/css'
              : 'image/png',
        });
      } catch {
        return route.fulfill({ status: 404 });
      }
    }
    if (url.pathname.includes('/progressive/')) {
      mediaRequests.push(url.pathname);
      return route.fulfill({
        body: await readFile(path.join(mediaFolder, 'fixture.mp4')),
        contentType: 'video/mp4',
      });
    }
    if (url.pathname.includes('/adaptive/')) {
      mediaRequests.push(url.pathname);
      const file = path.join(
        mediaFolder,
        url.pathname.endsWith('.m3u8') ? 'fixture.m3u8' : path.basename(url.pathname)
      );
      const bytes = await readFile(file);
      return route.fulfill({
        body: file.endsWith('.m3u8')
          ? bytes.toString().replaceAll('http://localhost:9090', host)
          : bytes,
        contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      });
    }
    if (url.pathname.endsWith('/views/increment'))
      return route.fulfill({ json: { isError: false, views: 2 } });
    if (url.pathname.endsWith('/comments'))
      return route.fulfill({
        json: {
          isError: false,
          comments: [
            {
              commentId: 1,
              timestamp: 1,
              commentPlainTextSanitized: 'Existing comment',
              replyIds: [],
              hasMoreReplies: false,
            },
          ],
          hasMore: false,
          totalCount: 1,
        },
      });
    return route.fulfill({ body: '', status: 404 });
  });
  await page.goto(host + '/watch?v=' + id + '&t=' + time);
  await expect(page.locator('#pc1')).toBeVisible();
  return { errors, mediaRequests, documentRequests, title, text };
}
test('metadata is inert in scripts, recommendation titles, and tags', async ({ page }) => {
  const { errors, title, text } = await fixture(page, { malicious: true });
  await expect(page.locator('#video-title')).toHaveText(title);
  await expect(page.locator('#video-information-description')).toHaveText(text);
  expect(await page.evaluate(() => (window as any).metadataExecuted)).toBeUndefined();
  await expect(page.locator('.video-recommendation-card-text').first()).toHaveText(title);
  expect(await page.locator('.video-recommendation-card-text img').count()).toBe(0);
  for (const tag of ['__proto__', 'hasOwnProperty']) {
    await page.locator('[data-tagterm]').filter({ hasText: tag }).click();
    await expect(page.locator('.video-recommendation-card-text').first()).toHaveText(title);
  }
  expect(errors).toEqual([]);
});
test('disabled actions stay disabled while existing comments remain readable', async ({ page }) => {
  const { errors } = await fixture(page, { closed: true });
  for (const selector of [
    '#video-like-button',
    '#video-dislike-button',
    '#video-report-button',
    '#comment-input-form-static textarea',
    '#comment-input-form-static button',
  ])
    await expect(page.locator(selector)).toBeDisabled();
  await expect(page.locator('#pc1 .comment-quote-button').first()).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await page
    .locator('#pc1 .comment-quote-button')
    .first()
    .evaluate((el: HTMLElement) => el.click());
  expect(await page.locator('#comment-input-form-dynamic').count()).toBe(0);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#comment-input-form-static textarea')).toBeDisabled();
  expect(errors).toEqual([]);
});
test('publishing status reaches the page', async ({ page }) => {
  const { errors } = await fixture(page, { publishing: true });
  await expect(page.locator('#video-player-container')).toContainText('currently publishing');
  expect(errors).toEqual([]);
});
for (const activation of ['poster', 'button', 'Enter', 'Space']) {
  test(`blocked autoplay resumes and stays playing after ${activation} activation`, async ({
    page,
  }) => {
    await page.goto('about:blank');
    test.skip(
      !(await page.evaluate(
        () =>
          typeof MediaSource !== 'undefined' ||
          !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl')
      )),
      'This browser build provides neither MediaSource nor native HLS'
    );
    await page.addInitScript(() => {
      const create = Document.prototype.createElement;
      Document.prototype.createElement = function (name: string, options?: ElementCreationOptions) {
        const element = create.call(this, name, options);
        if (name === 'hlsjs-video') {
          const play = (element as any).play.bind(element);
          Object.defineProperty(element, 'play', {
            configurable: true,
            value: function () {
              if (!(window as any).allowPlayback)
                return Promise.reject(new DOMException('Blocked autoplay', 'NotAllowedError'));
              return play();
            },
          });
          element.addEventListener('click', () => {
            (window as any).allowPlayback = true;
          });
        }
        return element;
      } as typeof Document.prototype.createElement;
      document.addEventListener(
        'click',
        () => {
          (window as any).allowPlayback = true;
        },
        true
      );
    });
    const { errors, mediaRequests, documentRequests } = await fixture(page, { playback: true });

    await expect(page.locator('#mtp-video-overlay')).toBeVisible();
    await page.waitForTimeout(2000);
    expect(mediaRequests.filter((url) => url.endsWith('.ts'))).toHaveLength(0);
    expect(documentRequests).toHaveLength(1);
    expect(await page.locator('hlsjs-video').evaluate((el: any) => el.source?.src)).toContain(
      'manifest-master.m3u8'
    );
    const canPlayHls = await page.evaluate(
      () =>
        typeof MediaSource !== 'undefined' ||
        !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl')
    );
    if (!canPlayHls) {
      expect(errors).toEqual([]);
      return;
    }
    if (activation === 'poster')
      await page.locator('#mtp-video-overlay').click({ position: { x: 30, y: 30 } });
    else if (activation === 'button')
      await page.getByRole('button', { name: 'Play video', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'Play video', exact: true }).focus();
      await page.keyboard.press(activation);
    }

    await expect
      .poll(() => page.locator('hlsjs-video').evaluate((el: any) => el.currentTime), {
        timeout: 20000,
      })
      .toBeGreaterThan(0);
    const startedAt = await page.locator('hlsjs-video').evaluate((el: any) => el.currentTime);
    await page.waitForTimeout(1000);
    expect(await page.locator('hlsjs-video').evaluate((el: any) => el.paused)).toBe(false);
    expect(await page.locator('hlsjs-video').evaluate((el: any) => el.currentTime)).toBeGreaterThan(
      startedAt
    );
    expect(mediaRequests.some((url) => url.endsWith('.ts'))).toBe(true);
    expect(mediaRequests.filter((url) => url.endsWith('manifest-master.m3u8'))).toHaveLength(1);
    expect(documentRequests).toHaveLength(1);
    const surface = page.locator('media-container');
    await surface.click({ position: { x: 30, y: 30 } });
    await expect
      .poll(() => page.locator('hlsjs-video').evaluate((el: any) => el.paused))
      .toBe(true);
    await surface.click({ position: { x: 30, y: 30 } });
    await expect
      .poll(() => page.locator('hlsjs-video').evaluate((el: any) => el.paused))
      .toBe(false);
    expect(errors).toEqual([]);
  });
}

test('autoplay, initial seek, quality switching, pause and resume remain functional', async ({
  page,
}) => {
  await page.goto('about:blank');
  const canPlayHls = await page.evaluate(
    () =>
      typeof MediaSource !== 'undefined' ||
      !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl')
  );
  test.skip(!canPlayHls, 'This browser build provides neither MediaSource nor native HLS');
  const { errors } = await fixture(page, { playback: true, time: 3 });
  const media = page.locator('hlsjs-video');
  await expect.poll(() => media.evaluate((el: any) => el.currentTime)).toBeGreaterThanOrEqual(3);
  await media.evaluate((el: any) => {
    el.pause();
    el.playbackRate = 1.5;
  });
  const time = await media.evaluate((el: any) => el.currentTime);
  await page.locator('.mt-settings').click();
  await page.getByRole('menuitem', { name: /^Quality/ }).click();
  await page.getByRole('menuitem', { name: 'm3u8', exact: false }).click();
  await page.getByRole('menuitemradio', { name: '720p', exact: true }).click();
  await expect.poll(() => media.evaluate((el: any) => el.readyState)).toBeGreaterThan(0);
  expect(await media.evaluate((el: any) => el.paused)).toBe(true);
  expect(await media.evaluate((el: any) => el.currentTime)).toBeCloseTo(time, 0);
  expect(await media.evaluate((el: any) => el.playbackRate)).toBe(1.5);
  await page.locator('.mt-settings').click();
  await page.locator('media-play-button').click();
  await expect.poll(() => media.evaluate((el: any) => el.currentTime)).toBeGreaterThan(time);
  expect(errors).toEqual([]);
});

test('native progressive video defers loading after blocked autoplay and starts with one click', async ({
  page,
}) => {
  await page.goto('about:blank');
  const fixtureBytes = await readFile(path.join(mediaFolder, 'fixture.mp4'));
  await page.route('http://decoder.test/fixture.mp4', (route) =>
    route.fulfill({ body: fixtureBytes, contentType: 'video/mp4' })
  );
  const probe = await page.evaluate(
    () =>
      new Promise<{ supported: boolean; code?: number }>((resolve) => {
        const video = document.createElement('video');
        let timer: ReturnType<typeof setTimeout>;
        const finish = (supported: boolean, code?: number) => {
          clearTimeout(timer);
          video.onloadedmetadata = null;
          video.onerror = null;
          video.removeAttribute('src');
          video.load();
          video.remove();
          resolve({ supported, code });
        };
        video.preload = 'metadata';
        document.body.append(video);
        video.onloadedmetadata = () => finish(true);
        video.onerror = () => finish(false, video.error?.code);
        timer = setTimeout(() => finish(false, video.error?.code), 3000);
        video.src = 'http://decoder.test/fixture.mp4';
        video.load();
      })
  );
  test.skip(
    !probe.supported && probe.code === 4,
    'This browser build cannot decode the generated H.264/AAC fixture'
  );
  expect(probe.supported).toBe(true);
  await page.addInitScript(() => {
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (name: string, options?: ElementCreationOptions) {
      const element = create.call(this, name, options);
      if (name === 'video') {
        const play = (element as HTMLVideoElement).play.bind(element);
        Object.defineProperty(element, 'play', {
          configurable: true,
          value: () => {
            if (!(window as any).allowNativePlayback)
              return Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
            return play();
          },
        });
      }
      return element;
    } as typeof Document.prototype.createElement;
    document.addEventListener(
      'click',
      () => {
        (window as any).allowNativePlayback = true;
      },
      true
    );
  });
  const { errors, mediaRequests, documentRequests } = await fixture(page, {
    playback: true,
    progressive: true,
  });
  await expect(page.locator('#mtp-video-overlay')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(mediaRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  const media = page.locator('.mt-media-slot > video');
  await expect
    .poll(() => media.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0);
  const start = await media.evaluate((el: HTMLVideoElement) => el.currentTime);
  await page.waitForTimeout(700);
  expect(await media.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
  expect(await media.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(start);
  expect(documentRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});
