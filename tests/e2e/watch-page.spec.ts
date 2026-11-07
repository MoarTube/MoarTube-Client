import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpegBinaries } from '../../src/utils/ffmpeg-path.js';
import path from 'node:path';
import ejs from 'ejs';
interface FixturePlaybackElement extends HTMLMediaElement {
  source?: { src?: string };
}
declare global {
  interface Window {
    metadataExecuted?: boolean;
    allowPlayback?: boolean;
    allowNativePlayback?: boolean;
  }
}
const root = path.resolve(process.env['MOARTUBE_NODE_SOURCE_DIR'] ?? '../MoarTube-Node');
const host = 'http://watch.test',
  id = 'aaaaaaaaaaa';
let mediaFolder: string;
test.beforeAll(async () => {
  mediaFolder = await mkdtemp(path.join(tmpdir(), 'moartube-watch-playback-'));
  await promisify(execFile)(resolveFfmpegBinaries().ffmpeg, [
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
  await promisify(execFile)(resolveFfmpegBinaries().ffmpeg, [
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
  ) {
    throw new Error('Unexpected fixture directory');
  }
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
        nodeHeadline: 'Fixture',
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
    if (url.hostname !== 'watch.test') {
      return route.fulfill({ body: '', contentType: 'application/javascript' });
    }
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
    if (url.pathname.endsWith('/views/increment')) {
      return route.fulfill({ json: { isError: false, views: 2 } });
    }
    if (url.pathname.endsWith('/comments/cache')) {
      return route.fulfill({ json: { isError: false, epoch: model.commentsData.cacheEpoch, version: 1, comments: [], deletedIds: [], totalCount: 1, hasMore: false } });
    }
    if (url.pathname.endsWith('/comments')) {
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
    }
    return route.fulfill({ body: '', status: 404 });
  });
  await page.goto(host + '/watch?v=' + id + '&t=' + time);
  expect(await page.evaluate(() => document.compatMode)).toBe('CSS1Compat');
  await expect(page.locator('#pc1')).toBeAttached();
  return { errors, mediaRequests, documentRequests, title, text };
}
test('metadata is inert in scripts, recommendation titles, and tags', async ({ page }) => {
  const { errors, title, text } = await fixture(page, { malicious: true });
  await expect(page.locator('#node-name')).toHaveText('Fixture');
  await expect(page.locator('a[href="/"] img[src$="/icon.png"]')).toHaveCount(1);
  await expect(page.locator('#node-headline')).toHaveCount(0);
  await expect(page.locator('#video-title')).toHaveText(title);
  await expect(page.locator('#video-information-description')).toHaveText(text);
  expect(await page.evaluate(() => window.metadataExecuted)).toBeUndefined();
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
  ]) {
    await expect(page.locator(selector)).toBeDisabled();
  }
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
      const create: (
        this: Document,
        name: string,
        options?: ElementCreationOptions
      ) => HTMLElement = Document.prototype.createElement;
      Document.prototype.createElement = function (
        this: Document,
        name: string,
        options?: ElementCreationOptions
      ) {
        const element = create.call(this, name, options);
        if (name === 'hlsjs-video') {
          const play = (element as FixturePlaybackElement).play.bind(element);
          Object.defineProperty(element, 'play', {
            configurable: true,
            value: function () {
              if (!window.allowPlayback) {
                return Promise.reject(new DOMException('Blocked autoplay', 'NotAllowedError'));
              }
              return play();
            },
          });
          element.addEventListener('click', () => {
            window.allowPlayback = true;
          });
        }
        return element;
      } as typeof Document.prototype.createElement;
      document.addEventListener(
        'click',
        () => {
          window.allowPlayback = true;
        },
        true
      );
    });
    const { errors, mediaRequests, documentRequests } = await fixture(page, { playback: true });

    await expect(page.locator('#mtp-video-overlay')).toBeVisible();
    await page.waitForTimeout(2000);
    expect(mediaRequests.filter((url) => url.endsWith('.ts'))).toHaveLength(0);
    expect(documentRequests).toHaveLength(1);
    expect(
      await page.locator('hlsjs-video').evaluate((el: FixturePlaybackElement) => el.source?.src)
    ).toContain('manifest-master.m3u8');
    const canPlayHls = await page.evaluate(
      () =>
        typeof MediaSource !== 'undefined' ||
        !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl')
    );
    if (!canPlayHls) {
      expect(errors).toEqual([]);
      return;
    }
    if (activation === 'poster') {
      await page.locator('#mtp-video-overlay').click({ position: { x: 30, y: 30 } });
    } else if (activation === 'button') {
      await page.getByRole('button', { name: 'Play video', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Play video', exact: true }).focus();
      await page.keyboard.press(activation);
    }

    await expect
      .poll(
        () => page.locator('hlsjs-video').evaluate((el: FixturePlaybackElement) => el.currentTime),
        {
          timeout: 20000,
        }
      )
      .toBeGreaterThan(0);
    const startedAt = await page
      .locator('hlsjs-video')
      .evaluate((el: FixturePlaybackElement) => el.currentTime);
    await page.waitForTimeout(1000);
    expect(
      await page.locator('hlsjs-video').evaluate((el: FixturePlaybackElement) => el.paused)
    ).toBe(false);
    expect(
      await page.locator('hlsjs-video').evaluate((el: FixturePlaybackElement) => el.currentTime)
    ).toBeGreaterThan(startedAt);
    expect(mediaRequests.some((url) => url.endsWith('.ts'))).toBe(true);
    expect(mediaRequests.filter((url) => url.endsWith('manifest-master.m3u8'))).toHaveLength(1);
    expect(documentRequests).toHaveLength(1);
    const surface = page.locator('media-container');
    await surface.click({ position: { x: 30, y: 30 } });
    await expect
      .poll(() => page.locator('hlsjs-video').evaluate((el: FixturePlaybackElement) => el.paused))
      .toBe(true);
    await surface.click({ position: { x: 30, y: 30 } });
    await expect
      .poll(() => page.locator('hlsjs-video').evaluate((el: FixturePlaybackElement) => el.paused))
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
  await expect
    .poll(() => media.evaluate((el: FixturePlaybackElement) => el.currentTime))
    .toBeGreaterThanOrEqual(3);
  await media.evaluate((el: FixturePlaybackElement) => {
    el.pause();
    el.playbackRate = 1.5;
  });
  const time = await media.evaluate((el: FixturePlaybackElement) => el.currentTime);
  await page.locator('.mt-settings').click();
  await page.getByRole('menuitem', { name: /^Quality/ }).click();
  await page.getByRole('menuitem', { name: 'm3u8', exact: false }).click();
  await page.getByRole('menuitemradio', { name: '720p', exact: true }).click();
  await expect
    .poll(() => media.evaluate((el: FixturePlaybackElement) => el.readyState))
    .toBeGreaterThan(0);
  expect(await media.evaluate((el: FixturePlaybackElement) => el.paused)).toBe(true);
  expect(await media.evaluate((el: FixturePlaybackElement) => el.currentTime)).toBeCloseTo(time, 0);
  expect(await media.evaluate((el: FixturePlaybackElement) => el.playbackRate)).toBe(1.5);
  await page.locator('.mt-settings').click();
  await page.locator('media-play-button').click();
  await expect
    .poll(() => media.evaluate((el: FixturePlaybackElement) => el.currentTime))
    .toBeGreaterThan(time);
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
      new Promise<{ supported: boolean; code?: number | undefined }>((resolve) => {
        const video = document.createElement('video');
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
        const timer = setTimeout(() => finish(false, video.error?.code), 3000);
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
    const create: (this: Document, name: string, options?: ElementCreationOptions) => HTMLElement =
      Document.prototype.createElement;
    Document.prototype.createElement = function (
      this: Document,
      name: string,
      options?: ElementCreationOptions
    ) {
      const element = create.call(this, name, options);
      if (name === 'video') {
        const play = (element as HTMLVideoElement).play.bind(element);
        Object.defineProperty(element, 'play', {
          configurable: true,
          value: () => {
            if (!window.allowNativePlayback) {
              return Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
            }
            return play();
          },
        });
      }
      return element;
    } as typeof Document.prototype.createElement;
    document.addEventListener(
      'click',
      () => {
        window.allowNativePlayback = true;
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

for (const width of [390, 1448]) {
  test(`watch palette follows saved light and dark themes at width ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    const { errors } = await fixture(page);
    await expect(page.locator('#moartube-logo')).toHaveAttribute('href', 'https://www.moartube.com');
    await expect(page.locator('#watch-node-banner')).toHaveAttribute('href', '/');
    await expect(page.locator('#watch-node-banner img')).toBeVisible();
    const branding = await page.evaluate(() => {
      const logo = document.querySelector('#moartube-logo-light')!.getBoundingClientRect();
      const banner = document.querySelector('#watch-node-banner img')!.getBoundingClientRect();
      const divider = document.querySelector('.watch-brand-divider')!.getBoundingClientRect();
      return { logoWidth: logo.width, logoHeight: logo.height, bannerWidth: banner.width, bannerHeight: banner.height, ordered: logo.right < divider.left && divider.right < banner.left, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(branding).toEqual({ logoWidth: 90, logoHeight: 20, bannerWidth: 90, bannerHeight: 20, ordered: true, overflow: false });
    for (const side of ['top', 'right', 'bottom', 'left']) {
      await expect(page.locator('#video-player-information')).toHaveCSS('padding-' + side, width < 992 ? '16px' : '24px');
    }
    const lightPage = width < 992 ? 'rgb(255, 255, 255)' : 'rgb(237, 240, 243)';
    await expect(page.locator('body')).toHaveCSS('background-color', lightPage);
    await expect(page.locator('#video-player-information')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.locator('#navbar-settings-button').click();
    await page.locator('#darkModeSwitch').check();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(24, 26, 30)');
    await expect(page.locator('#video-player-information')).toHaveCSS('background-color', 'rgb(34, 37, 42)');
    await expect(page.locator('#video-comments-outer')).toHaveCSS('color', 'rgb(238, 238, 238)');
    await expect(page.locator('.video-recommendation-card').first()).toHaveCSS('background-color', 'rgb(34, 37, 42)');
    await expect(page.locator('#comment-input-form-static textarea')).toHaveCSS('color', 'rgb(238, 238, 238)');
    await expect(page.locator('#pc1 .postInfo .postNum a').first()).toHaveCSS('color', 'rgb(170, 170, 170)');
    await expect(page.locator('#video-player-information a').first()).toHaveCSS('text-decoration-line', 'none');
    await page.locator('#settingsModal .btn-close').click();
    await expect(page.locator('#settingsModal')).toBeHidden();
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('watch-dark.png') });
    await page.reload();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(24, 26, 30)');
    await page.locator('#navbar-settings-button').click();
    await page.locator('#darkModeSwitch').uncheck();
    await expect(page.locator('body')).toHaveCSS('background-color', lightPage);
    expect(errors).toEqual([]);
  });
}

test('selected tag recommendations survive a desktop comment permalink and mobile breakpoint changes', async ({ page }) => {
  await page.setViewportSize({ width: 1448, height: 900 });
  const { errors } = await fixture(page);
  await page.locator('[data-tagterm="test"]').click();
  await expect(page.locator('#recommended-videos-list > li')).toHaveCount(1);
  await page.locator('#pc1 .postInfo.desktop a[href="#p1"]').click();
  await expect(page).toHaveURL(/#p1$/);
  await expect(page.locator('#recommended-videos-list-container')).toBeVisible();
  await expect(page.locator('#recommended-videos-list > li')).toHaveCount(1);
  await page.locator('[data-tagterm=""]').click();
  await expect(page.locator('#recommended-videos-list > li')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator('#recommended-videos-list-container')).toBeHidden();
  await page.setViewportSize({ width: 1448, height: 900 });
  await expect(page.locator('#recommended-videos-list-container')).toBeVisible();
  await expect(page.locator('#recommended-videos-list > li')).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const width of [390, 1448]) {
  test(`watch details and comment composer match the approved layout at width ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors } = await fixture(page);
    for (const tag of await page.locator('.recommendation-category-button').all()) {
      await expect(tag).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(tag).toHaveCSS('color', 'rgb(0, 0, 0)');
      await tag.hover();
      await expect(tag).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    }
    await page.locator('[data-tagterm="test"]').click();
    await expect(page.locator('[data-tagterm="test"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    if (width < 992) await page.locator('#expand-comment-section').click();
    await expect(page.locator('.watch-comments-heading')).toHaveText('Comments ' + String.fromCodePoint(0xb7) + ' 1');
    await expect(page.locator('#video-title')).toHaveCSS('font-weight', '700');
    const input = page.locator('#comment-input-form-static textarea');
    await expect(input).toHaveCSS('border-top-width', '1px');
    await expect(input).toHaveCSS('border-radius', '8px');
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(80);
    await input.fill('Testing the composer');
    await input.fill('');
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(80);
    await expect(page.locator('#pc1 .postMenuBtn')).toHaveText(String.fromCodePoint(0x25b6));
    for (const selector of ['#video-like-button', '#video-dislike-button', '#video-share-button', '#video-donate-button', '#update-comments-button', '#comment-input-form-static button[type="submit"]']) {
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(0, 0, 0)');
    }
    for (const selector of ['#navbar-settings-button', '#navbar-donate-button', '#pc1 .postMenuBtn']) {
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(203, 12, 159)');
      await page.locator(selector).hover();
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(203, 12, 159)');
    }
    await page.locator('#update-comments-button').hover();
    await expect(page.locator('#update-comments-button')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const refresh = page.waitForResponse(response => response.url().includes('/comments/cache'));
    await page.locator('#update-comments-button').click();
    await refresh;
    await expect(page.locator('#update-comments-button')).toBeVisible();
    await expect(page.locator('#comment-section-update-descriptor')).toBeEmpty();
    expect(await page.locator('#video-information-container').evaluate(el => getComputedStyle(el).backgroundColor.startsWith('rgba(203, 12, 159,'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('#video-player-information').screenshot({ path: testInfo.outputPath('watch-details-light.png') });
    await page.locator('#navbar-donate-button').click();
    await expect(page.locator('.swal2-confirm')).toHaveCSS('color', 'rgb(0, 0, 0)');
    await expect(page.locator('.swal2-confirm a')).toHaveCSS('color', 'rgb(0, 0, 0)');
    await expect(page.locator('.swal2-cancel')).toHaveCSS('color', 'rgb(0, 0, 0)');
    await page.locator('.swal2-close').click();
    await expect(page.locator('.swal2-container')).toHaveCount(0);
    await page.locator('#navbar-settings-button').click();
    await page.locator('#darkModeSwitch').check();
    await page.locator('#settingsModal .btn-close').click();
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
    await expect(page.locator('#update-comments-button')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    for (const selector of ['#video-like-button', '#video-dislike-button', '#video-share-button', '#video-donate-button', '#update-comments-button', '#comment-input-form-static button[type="submit"]']) {
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(255, 255, 255)');
    }
    for (const selector of ['#navbar-settings-button', '#navbar-donate-button', '#pc1 .postMenuBtn']) {
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(203, 12, 159)');
      await page.locator(selector).hover();
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(203, 12, 159)');
      await page.locator(selector).focus();
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(203, 12, 159)');
    }
    await page.locator('#pc1 .postMenuBtn').click();
    await expect(page.locator('#pc1 .postMenuBtn')).toHaveClass(/show/);
    await expect(page.locator('#pc1 .postMenuBtn')).toHaveCSS('color', 'rgb(203, 12, 159)');
    await page.keyboard.press('Escape');
    await page.locator('#video-player-information').screenshot({ path: testInfo.outputPath('watch-details-dark.png') });
    expect(errors).toEqual([]);
  });
}

for (const width of [390, 1448]) {
  test(`watch action buttons keep active contrast until their popup closes at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors } = await fixture(page);
    await page.route('**/videos/aaaaaaaaaaa/like', route => route.fulfill({ json: { isError: false } }));
    await page.route('**/videos/aaaaaaaaaaa/dislike', route => route.fulfill({ json: { isError: false } }));
    await page.route('**/videos/aaaaaaaaaaa/data', route => route.fulfill({ json: { isError: false } }));
    const normal = async (selector: string) => {
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(0, 0, 0)');
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    };
    const active = async (selector: string) => {
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(203, 12, 159)');
      await expect(page.locator(selector + ' svg')).toHaveCSS('fill', 'rgb(255, 255, 255)');
    };
    await normal('#video-like-button');
    await page.locator('#video-like-button').click();
    await active('#video-like-button');
    await expect(page.locator('#video-like-button')).toBeEnabled();
    await page.locator('#video-dislike-button').click();
    await active('#video-dislike-button');
    await normal('#video-like-button');
    await expect(page.locator('#video-dislike-button')).toBeEnabled();
    await page.locator('#video-share-button').click();
    await expect(page.locator('.watch-share-dialog')).toBeVisible();
    await active('#video-share-button');
    await page.locator('.swal2-close').click();
    await expect(page.locator('.swal2-container')).toHaveCount(0);
    await normal('#video-share-button');
    await page.locator('#video-share-button').click();
    await active('#video-share-button');
    await page.evaluate('window.watchFixture.showAlert(true, "Replacement")');
    await expect(page.locator('.swal2-container')).toBeVisible();
    await normal('#video-share-button');
    await page.locator('.swal2-confirm').click();
    await expect(page.locator('.swal2-container')).toHaveCount(0);
    for (const walletInstalled of [false, true]) {
      if (walletInstalled) await page.evaluate('window.ethereum = {}');
      await page.locator('#video-donate-button').click();
      await expect(page.locator('.watch-video-donate-dialog')).toBeVisible();
      await active('#video-donate-button');
      await page.locator('.swal2-cancel').click();
      await expect(page.locator('.swal2-container')).toHaveCount(0);
      await normal('#video-donate-button');
    }
    await page.locator('#navbar-donate-button').click();
    await expect(page.locator('.watch-navbar-donate-dialog')).toBeVisible();
    await expect(page.locator('#navbar-donate-button svg')).toHaveCSS('fill', 'rgb(203, 12, 159)');
    await normal('#video-donate-button');
    await page.locator('.swal2-close').click();
    await expect(page.locator('.swal2-container')).toHaveCount(0);
    await expect(page.locator('#navbar-donate-button')).toHaveCSS('color', 'rgb(203, 12, 159)');
    await page.locator('#overflow-dropdown-button').click();
    await expect(page.locator('.dropdown-menu.show')).toBeVisible();
    await active('#overflow-dropdown-button');
    await page.keyboard.press('Escape');
    await expect(page.locator('.dropdown-menu.show')).toHaveCount(0);
    await normal('#overflow-dropdown-button');
    await page.locator('#overflow-dropdown-button').click();
    await active('#overflow-dropdown-button');
    await page.locator('#video-title').click();
    await expect(page.locator('.dropdown-menu.show')).toHaveCount(0);
    await normal('#overflow-dropdown-button');
    expect(errors).toEqual([]);
  });
}

for (const width of [390, 1448]) {
  test(`comment quote highlights preserve geometry and selection at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    const { errors } = await fixture(page);
    if (width < 992) await page.locator('#expand-comment-section').click();
    await page.evaluate(() => {
      const watch = (window as any).watchFixture;
      watch.loadComments([{ commentId: 2, timestamp: 2, commentPlainTextSanitized: '&gt;&gt;1 reply', replyIds: [], hasMoreReplies: false }], false);
      document.querySelector('#comment-section')!.scrollIntoView({ block: 'start' });
    });
    const target = page.locator('#comments-container #p1');
    const quote = page.locator('#pc2 blockquote .quotelink');
    const backlink = page.locator('#pc1 .backlink .quotelink[data-comment-id="2"]');
    const geometry = () => page.locator('#comments-container').evaluate(el =>
      [...el.querySelectorAll('.postContainer, .post.reply, .quotelink')].map(item => {
        const r = item.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
    );
    for (const dark of [false, true]) {
      if (dark) {
        await page.locator('#navbar-settings-button').click();
        await page.locator('#darkModeSwitch').check();
        await page.locator('#settingsModal .btn-close').click();
        await expect(page.locator('.modal-backdrop')).toHaveCount(0);
      }
      await page.evaluate(() => (window as any).watchFixture.clearCommentHighlights());
      await page.mouse.move(0, 0);
      await page.locator('#comments-container').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const baseline = await geometry();
      await quote.hover();
      await expect(target).toHaveClass(/\bhighlight\b/);
      expect(await geometry()).toEqual(baseline);
      await page.mouse.move(0, 0);
      await expect(target).not.toHaveClass(/\bhighlight\b/);
      expect(await geometry()).toEqual(baseline);
      // A backlink in the target's preceding row must stay under a stationary pointer.
      await backlink.hover();
      await expect(page.locator('#p2')).toHaveClass(/\bhighlight\b/);
      expect(await geometry()).toEqual(baseline);
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        const watch = (window as any).watchFixture;
        watch.COMMENT_HIGHLIGHT_ID = 1;
        watch.restoreCommentHighlight();
      });
      const selected = await geometry();
      await expect(target).toHaveCSS('background-color', dark ? 'rgb(50, 54, 62)' : 'rgb(237, 227, 235)');
      await quote.hover();
      await expect(target).toHaveClass(/\bhighlight-anti\b/);
      await expect(target).toHaveCSS('background-color', dark ? 'rgb(39, 39, 39)' : 'rgb(191, 166, 186)');
      expect(await geometry()).toEqual(selected);
      await page.mouse.move(0, 0);
      await expect(target).not.toHaveClass(/\bhighlight-anti\b/);
      await expect(target).toHaveClass(/\bhighlight\b/);
      expect(await geometry()).toEqual(selected);
      await page.evaluate(() => {
        (window as any).watchFixture.clearCommentHighlights();
        document.querySelector('#p1')!.classList.add('new-comment-highlight');
      });
      await quote.hover();
      await expect(target).toHaveClass(/\bhighlight-anti\b/);
      await page.mouse.move(0, 0);
      await expect(target).not.toHaveClass(/\bhighlight-anti\b/);
      await expect(target).toHaveClass(/\bnew-comment-highlight\b/);
      expect(await geometry()).toEqual(baseline);
      await page.evaluate(() => (window as any).watchFixture.clearCommentHighlights());
    }
    expect(errors).toEqual([]);
  });
}
