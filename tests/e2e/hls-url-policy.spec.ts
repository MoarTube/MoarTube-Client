import { test, expect } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import ejs from 'ejs';
import { resolveFfmpegBinaries } from '../../src/utils/ffmpeg-path.js';

const nodeRoot = path.resolve(process.env['MOARTUBE_NODE_SOURCE_DIR'] ?? '../MoarTube-Node');
const id = 'aaaaaaaaaaa';
const hlsRoot = `/external/videos/${id}/adaptive/m3u8/`;
let directory: string;

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'moartube-hls-browser-'));
  await promisify(execFile)(
    resolveFfmpegBinaries().ffmpeg,
    [
      '-nostdin',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=426x240:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '6',
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
      path.join(directory, 'segment-%d.ts'),
      path.join(directory, 'fixture.m3u8'),
    ],
    { windowsHide: true, timeout: 15_000 }
  );
});

test.afterAll(async () => {
  if (
    directory &&
    path.dirname(directory) === path.resolve(tmpdir()) &&
    path.basename(directory).startsWith('moartube-hls-browser-')
  ) {
    await rm(directory, { recursive: true, force: true });
  }
});

const configurations = [
  { name: 'filesystem public domain', origin: 'https://node.example.test', mediaBase: '' },
  { name: 'filesystem LAN address', origin: 'http://192.168.50.10:9090', mediaBase: '' },
  {
    name: 'filesystem tunnel address',
    origin: 'https://random-label.trycloudflare.com',
    mediaBase: '',
  },
  {
    name: 'S3 path-style',
    origin: 'https://node.example.test',
    mediaBase: 'https://s3.example.test/bucket',
  },
  {
    name: 'S3 virtual-host style',
    origin: 'https://node.example.test',
    mediaBase: 'https://bucket.s3.example.test',
  },
  {
    name: 'Cloudflare CDN',
    origin: 'https://node.example.test',
    mediaBase: 'https://externalvideos.node.example.test',
  },
];

for (const configuration of configurations) {
  for (const embedded of [false, true]) {
    test(`${configuration.name}: ${embedded ? 'cross-site iframe' : 'watch page'} plays relative HLS`, async ({
      page,
    }) => {
      await page.goto('about:blank');
      const canDecode = await page.evaluate(() => {
        const native = document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
        return (
          Boolean(native) ||
          (typeof MediaSource !== 'undefined' &&
            MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"') &&
            MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'))
        );
      });
      test.skip(
        !canDecode,
        'This browser build has no native HLS or H.264/AAC MediaSource decoders.'
      );
      const { origin, mediaBase } = configuration;
      const parentOrigin = new URL(origin).protocol + '//parent.example.test';
      const masterPath = hlsRoot + 'static/manifests/manifest-master.m3u8';
      const renditionPath = hlsRoot + 'static/manifests/manifest-240p.m3u8';
      const masterUrl = (mediaBase || origin) + masterPath;
      const model = {
        externalVideosBaseUrl: mediaBase,
        externalResourcesBaseUrl: '',
        canonicalOrigin: origin,
        informationData: {
          information: {
            nodeName: 'HLS fixture',
            nodeVideoCount: 1,
            nodeAbout: '',
            publicNodeProtocol: 'https',
            publicNodeAddress: 'configured-public.example.test',
            publicNodePort: '443',
            cloudflareTurnstileSiteKey: '',
          },
        },
        linksData: { links: [] },
        cryptoWalletAddressesData: { cryptoWalletAddresses: [] },
        commentsData: {
          totalCount: 0,
          hasMore: false,
          cacheEpoch: '11111111-1111-4111-8111-111111111111',
          cacheVersion: 1,
          cdnEnabled: false,
        },
        videoData: {
          video: {
            videoId: id,
            title: 'Relative HLS',
            description: '',
            tags: '',
            views: 1,
            likes: 0,
            dislikes: 0,
            comments: 0,
            isPublished: true,
            isPublishing: false,
            isLive: false,
            isStreaming: false,
            isStreamed: false,
            isLikesEnabled: false,
            isDislikesEnabled: false,
            isReportsEnabled: false,
            isCommentsEnabled: false,
            isLiveChatEnabled: false,
            creationTimestamp: 1,
            adaptiveSources: [
              { src: mediaBase + masterPath, type: 'application/vnd.apple.mpegurl' },
              { src: mediaBase + renditionPath, type: 'application/vnd.apple.mpegurl' },
            ],
            progressiveSources: [],
            sourcesFormatsAndResolutions: { m3u8: ['240p'], mp4: [], webm: [], ogv: [] },
          },
        },
        recommendedVideosData: { recommendedVideos: [] },
      };
      const html = ejs.render(
        await readFile(
          path.join(nodeRoot, 'public/views', embedded ? 'embed-video.ejs' : 'watch.ejs'),
          'utf8'
        ),
        { model }
      );
      const mediaRequests: string[] = [];
      const unexpected: string[] = [];
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const embedUrl = origin + `/watch/embed/video/${id}?autostart=1`;
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === parentOrigin) {
          return route.fulfill({
            contentType: 'text/html',
            body: `<iframe title="MoarTube" allow="autoplay" src="${embedUrl}" style="width:960px;height:600px"></iframe>`,
          });
        }
        if (
          url.origin === origin &&
          (url.pathname === '/watch' || url.pathname.startsWith('/watch/embed/video/'))
        ) {
          return route.fulfill({ contentType: 'text/html', body: html });
        }
        if (url.origin === origin && url.pathname.startsWith('/external/resources/')) {
          const file = path.join(nodeRoot, 'public', ...url.pathname.split('/').slice(3));
          try {
            return route.fulfill({
              body: await readFile(file),
              contentType: file.endsWith('.js')
                ? 'application/javascript'
                : file.endsWith('.css')
                  ? 'text/css'
                  : file.endsWith('.svg')
                    ? 'image/svg+xml'
                    : 'image/png',
            });
          } catch {
            return route.fulfill({ status: 404, body: '' });
          }
        }
        if (url.pathname.includes('/adaptive/')) {
          const expectedBase = mediaBase || origin;
          if (!url.href.startsWith(expectedBase + hlsRoot)) {
            unexpected.push(url.href);
            return route.fulfill({ status: 503, body: 'Incorrect media origin or bucket path' });
          }
          mediaRequests.push(url.href);
          const headers = {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': 'GET, HEAD, OPTIONS',
          };
          if (url.href === masterUrl) {
            return route.fulfill({
              headers,
              contentType: 'application/vnd.apple.mpegurl',
              body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=426x240\nmanifest-240p.m3u8\n',
            });
          }
          if (url.href === expectedBase + renditionPath) {
            const playlist = (await readFile(path.join(directory, 'fixture.m3u8'), 'utf8'))
              .split('\n')
              .map((line) => (line && !line.startsWith('#') ? '../../240p/segments/' + line : line))
              .join('\n');
            return route.fulfill({
              headers,
              contentType: 'application/vnd.apple.mpegurl',
              body: playlist,
            });
          }
          if (new RegExp(`/240p/segments/segment-\\d+\\.ts$`).test(url.pathname)) {
            return route.fulfill({
              headers,
              contentType: 'video/mp2t',
              body: await readFile(path.join(directory, path.basename(url.pathname))),
            });
          }
          unexpected.push(url.href);
          return route.fulfill({ status: 404, body: '' });
        }
        if (
          url.origin === origin &&
          (url.pathname.endsWith('/comments/cache') || url.pathname.endsWith('/comments'))
        ) {
          return route.fulfill({
            json: {
              isError: false,
              comments: [],
              totalCount: 0,
              hasMore: false,
              deletedIds: [],
              epoch: model.commentsData.cacheEpoch,
              version: 1,
            },
          });
        }
        if (url.origin === origin && url.pathname.endsWith('/views/increment')) {
          return route.fulfill({ json: { isError: false, views: 2 } });
        }
        return route.fulfill({ status: 404, body: '' });
      });
      await page.goto(embedded ? parentOrigin + '/' : origin + '/watch?v=' + id);
      const media = embedded
        ? page.frameLocator('iframe[title="MoarTube"]').locator('hlsjs-video')
        : page.locator('hlsjs-video');
      await expect(media).toBeAttached();
      await expect
        .poll(() => media.evaluate((element) => (element as HTMLMediaElement).currentTime))
        .toBeGreaterThan(0.5);
      const time = await media.evaluate((element) => (element as HTMLMediaElement).currentTime);
      await expect
        .poll(() => media.evaluate((element) => (element as HTMLMediaElement).currentTime))
        .toBeGreaterThan(time + 0.2);
      expect(mediaRequests).toContain(masterUrl);
      expect(mediaRequests).toContain((mediaBase || origin) + renditionPath);
      expect(mediaRequests.some((url) => url.includes('/240p/segments/segment-'))).toBe(true);
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
