import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ejs from 'ejs';
import ffmpeg from 'ffmpeg-static';

interface FixtureMedia extends HTMLMediaElement {
  source: { engine: { hlsJs: { backBufferLength: number; maxBufferSize: number } } };
}
declare global {
  interface Window {
    testPlayer: { media: FixtureMedia; destroy(): void };
  }
}
const client = path.resolve('.');
const node = path.resolve('../MoarTube-Node');
let mediaDirectory: string;
const video = (id: number) => ({
  video_id: String(id),
  title: `Video ${id}`,
  tags: 'test',
  views: 0,
  comments: 0,
  likes: 0,
  dislikes: 0,
  bandwidth: 0,
  creation_timestamp: 100,
  length_timestamp: '00:02:40',
  is_live: false,
  is_streaming: false,
});
const information = {
  nodeVideoCount: 205,
  nodeName: 'Fixture Node',
  nodeAbout: '',
  publicNodeProtocol: 'http',
  publicNodeAddress: 'memory.local',
  publicNodePort: '80',
};

async function routes(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'memory.local') {
      return route.fulfill({ body: '', contentType: 'application/javascript' });
    }
    const name = url.pathname;
    if (name.startsWith('/media/')) {
      const file = path.resolve(mediaDirectory, name.slice(7));
      if (!file.startsWith(mediaDirectory + path.sep)) {
        throw new Error('Invalid fixture path');
      }
      return route.fulfill({
        body: await readFile(file),
        contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      });
    }
    if (name === '/player') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<html><head><link rel="stylesheet" href="/external/resources/css/videojs-10.2.0.css"></head><body><div id="main-container"><div><div id="placeholder"></div></div><div id="theater-container"></div></div><script type="module">import {createVideoPlayer} from '/external/resources/javascript/videojs-10.2.0.js';window.testPlayer=createVideoPlayer({placeholder:document.getElementById('placeholder'),adaptiveSources:[{src:'/media/manifest-720p.m3u8',type:'application/vnd.apple.mpegurl'}],progressiveSources:[],isStreaming:false,timeParameter:0,videoId:'fixture',copyText:async()=>{}});</script></body></html>`,
      });
    }
    if (name.startsWith('/reports/') && !name.endsWith('/all')) {
      const kind = name.includes('comments') ? 'comments' : 'videos';
      const reports = Array.from({ length: 100 }, (_, id) => ({
        report_id: id + 1,
        archive_id: id + 1,
        video_id: String(id),
        comment_id: id + 1,
        timestamp: 100,
        comment_timestamp: 100,
        video_timestamp: 100,
        email: 'fixture@example.test',
        type: 'spam',
        message: 'Fixture report',
      }));
      const model = {
        nodeSettings: information,
        newContentCounts: {
          newCommentsCount: 0,
          newVideoReportsCount: 0,
          newCommentReportsCount: 0,
        },
        videoReports: reports,
        videoReportsArchive: [],
        commentReports: reports,
        commentReportsArchive: [],
        reportPage: Number(url.searchParams.get('page') || 0),
        archivePage: Number(url.searchParams.get('archivePage') || 0),
        reportHasMore: true,
        archiveHasMore: true,
        search: url.searchParams.get('search') || '',
      };
      return route.fulfill({
        contentType: 'text/html',
        body: await ejs.renderFile(path.join(client, 'public/views', `reports-${kind}.ejs`), {
          model,
        }),
      });
    }
    if (name === '/videos') {
      const model = {
        informationData: { isError: false, information },
        linksData: { links: [] },
        cryptoWalletAddressesData: { cryptoWalletAddresses: [] },
        tagsData: { tags: ['test'] },
        searchResultsData: {
          searchResults: Array.from({ length: 5 }, (_, i) => video(i)),
          offset: 0,
          hasMore: true,
        },
        externalResourcesBaseUrl: 'http://memory.local',
        externalVideosBaseUrl: 'http://memory.local',
      };
      return route.fulfill({
        contentType: 'text/html',
        body: await ejs.renderFile(path.join(node, 'public/views/node.ejs'), { model }),
      });
    }
    if (name === '/node/search') {
      const offset = Number(url.searchParams.get('offset') || 0);
      return route.fulfill({
        json: {
          isError: false,
          searchResults: Array.from({ length: 5 }, (_, i) => video(offset + i)),
          offset,
          hasMore: offset < 100,
        },
      });
    }
    const asset = name.startsWith('/external/resources/')
      ? path.join(node, 'public', name.slice('/external/resources/'.length))
      : path.join(client, 'public', name);
    if (/\.(js|css|woff2?|png|jpg|svg|ico)$/.test(name)) {
      try {
        return await route.fulfill({ path: asset });
      } catch {
        return route.fulfill({ body: '', status: 404 });
      }
    }
    return route.fulfill({ json: { isError: false, isAuthenticated: true, reports: [] } });
  });
}

test.beforeAll(async () => {
  mediaDirectory = await mkdtemp(path.join(tmpdir(), 'moartube-browser-media-'));
  await promisify(execFile)(
    ffmpeg as unknown as string,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=10',
      '-t',
      '160',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads',
      '1',
      '-b:v',
      '40k',
      '-g',
      '20',
      '-sc_threshold',
      '0',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '0',
      '-hls_playlist_type',
      'vod',
      path.join(mediaDirectory, 'manifest-720p.m3u8'),
    ],
    { timeout: 30_000, windowsHide: true }
  );
});
test.afterAll(async () => {
  if (
    mediaDirectory &&
    path.dirname(mediaDirectory) === path.resolve(tmpdir()) &&
    path.basename(mediaDirectory).startsWith('moartube-browser-media-')
  ) {
    await rm(mediaDirectory, { recursive: true, force: true });
  }
});

for (const kind of ['videos', 'comments']) {
  test(`moderation ${kind} pages keep navigation and search functional`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await routes(page);
    await page.goto(`http://memory.local/reports/${kind}?page=2&archivePage=3&search=spam`);
    const reportNav = page.getByRole('navigation', { name: 'Report pages' });
    await expect(reportNav).toContainText('Page 3');
    await reportNav.getByRole('link', { name: 'Next reports' }).click();
    await expect(reportNav).toContainText('Page 4');
    await expect(page.getByRole('navigation', { name: 'Archive pages' })).toContainText('Page 4');
    await page.getByRole('textbox', { name: 'Search reports and archives' }).fill('other');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(reportNav).toContainText('Page 1');
    expect(errors).toEqual([]);
  });
}

test('catalog pages replace visible results instead of retaining prior pages', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await routes(page);
  await page.goto('http://memory.local/videos');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Video 100', { exact: true })).toBeVisible();
  await expect(page.getByText('Video 0', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('Video 0', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('HLS playback and seeking work with a finite media back buffer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await routes(page);
  await page.goto('http://memory.local/player');
  await expect
    .poll(() => page.evaluate(() => Number(window.testPlayer?.media?.readyState || 0)))
    .toBeGreaterThanOrEqual(2);
  const config = await page
    .locator('hlsjs-video')
    .evaluate((media) => (media as FixtureMedia).source.engine.hlsJs);
  expect(config.backBufferLength).toBe(60);
  expect(config.maxBufferSize).toBe(30_000_000);
  await page.evaluate(async () => {
    const media = window.testPlayer.media;
    await media.play();
    media.currentTime = 130;
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const media = window.testPlayer.media;
        return media.buffered.length ? media.buffered.start(0) : 0;
      })
    )
    .toBeGreaterThanOrEqual(60);
  await page.evaluate(() => window.testPlayer.destroy());
  await expect(page.locator('moartube-video-player')).toHaveCount(0);
  expect(errors).toEqual([]);
});
