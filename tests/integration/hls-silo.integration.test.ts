import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import pino from 'pino';
import type { S3Client } from '@aws-sdk/client-s3';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Service, type S3ValidationConfig } from '../../src/services/s3.js';
import { Logger } from '../../src/utils/logger.js';

import { siloFixture, type SiloFixture } from '../support/silo.js';

// Opt-in FFmpeg checks; signed and anonymous S3 requests reach a real Silo server.
const enabled = process.env['MOARTUBE_TEST_HLS'] === '1';
const livePolicy = 'public, max-age=0, s-maxage=1, must-revalidate';
const vodPolicy = 'public, max-age=0, s-maxage=30, must-revalidate';
const contentType = 'application/vnd.apple.mpegurl';

describe.skipIf(!enabled)('HLS caching against a real local Silo server', () => {
  let fixture: SiloFixture | undefined;
  let bucket: string;
  let config: S3ValidationConfig;
  let client: S3Client;
  let service: S3Service;
  let initialized = false;
  let publicBase: string;
  let firstSegment: Buffer;
  let resumedSegment: Buffer;
  const ffmpeg = process.env['MOARTUBE_FFMPEG'] ?? 'ffmpeg';

  function makeSegment(color: string): Buffer {
    const result = spawnSync(
      ffmpeg,
      [
        '-nostdin',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=128x72:r=10:d=2`,
        '-an',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '20',
        '-f',
        'mpegts',
        'pipe:1',
      ],
      { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 }
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`FFmpeg fixture generation failed: ${result.stderr.toString()}`);
    }
    return result.stdout;
  }

  beforeAll(async () => {
    fixture = await siloFixture(true);
    config = fixture.config;
    bucket = config.bucketName;
    client = fixture.client;
    service = new S3Service(new Logger({}, pino({ level: 'silent' })));
    initialized = true;
    if (fixture.publicBase === undefined) {
      throw new Error('Silo public-read bucket policy fixture is required');
    }
    publicBase = fixture.publicBase;
    firstSegment = makeSegment('black');
    resumedSegment = makeSegment('blue');
  }, 30_000);

  afterAll(async () => {
    if (initialized) {
      service.close();
    }
    await fixture?.close();
  }, 30_000);

  function keys(
    id: string,
    resolution = '720p'
  ): {
    prefix: string;
    dynamic: string;
    master: string;
    vod: string;
    vodMaster: string;
    segment: string;
  } {
    const prefix = `external/videos/${id}/adaptive/m3u8/`;
    return {
      prefix,
      dynamic: `${prefix}dynamic/manifests/manifest-${resolution}.m3u8`,
      master: `${prefix}dynamic/manifests/manifest-master.m3u8`,
      vod: `${prefix}static/manifests/manifest-${resolution}.m3u8`,
      vodMaster: `${prefix}static/manifests/manifest-master.m3u8`,
      segment: `${prefix}${resolution}/segments/segment-run-one-0.ts`,
    };
  }

  async function read(key: string, expectedPolicy: string): Promise<string> {
    const response = await fetch(`${publicBase}/${key}`, { signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(expectedPolicy);
    return response.text();
  }

  async function seed(id: string): Promise<ReturnType<typeof keys>> {
    const key = keys(id);
    await service.putObjectFromData(config, key.segment, firstSegment, 'video/mp2t');
    await service.putObjectFromData(
      config,
      key.dynamic,
      Buffer.from(
        `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:2,\n../../720p/segments/segment-run-one-0.ts\n`
      ),
      contentType
    );
    await service.putObjectFromData(
      config,
      key.master,
      Buffer.from(`#EXTM3U\n#MOARTUBE-LIVE\n#EXT-X-STREAM-INF:BANDWIDTH=100\nmanifest-720p.m3u8\n`),
      contentType
    );
    return key;
  }

  it('stores and serves the real live master/media cache metadata to anonymous viewers', async () => {
    const key = await seed('live');
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key.dynamic }));
    expect(head.CacheControl).toBe(livePolicy);
    expect(head.ContentType).toBe(contentType);
    expect(await read(key.master, livePolicy)).toContain('manifest-720p.m3u8');
    expect(await read(key.dynamic, livePolicy)).toContain(
      '../../720p/segments/segment-run-one-0.ts'
    );
    const segment = await fetch(`${publicBase}/${key.segment}`, {
      signal: AbortSignal.timeout(5000),
    });
    expect(segment.headers.get('cache-control')).toBe(vodPolicy);
    expect(Buffer.from(await segment.arrayBuffer())).toEqual(firstSegment);
    const publicHead = await fetch(`${publicBase}/${key.dynamic}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    expect(publicHead.status).toBe(200);
    expect(publicHead.headers.get('cache-control')).toBe(livePolicy);
    expect(await publicHead.text()).toBe('');
  });

  it('replaces streamed growing playlists and their real object validators', async () => {
    const key = await seed('growing');
    const first = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key.dynamic }));
    const next = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:2,\n../../720p/segments/segment-run-one-0.ts\n#EXTINF:2,\n../../720p/segments/segment-run-one-0.ts\n`;
    await service.putObjectFromData(
      config,
      key.dynamic,
      Readable.from([next.slice(0, 40), next.slice(40)]),
      contentType,
      undefined,
      { liveSnapshot: Buffer.from(next) }
    );
    const replaced = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key.dynamic }));
    expect(replaced.ETag).not.toBe(first.ETag);
    expect(await read(key.dynamic, livePolicy)).toBe(next);
  });

  it('finalizes real objects into playable VOD and uncached terminal dynamic media, idempotently', async () => {
    const key = await seed('recorded');
    await service.convertM3u8DynamicManifestsToStatic(config, 'recorded', ['720p']);
    const terminal = await read(key.dynamic, 'no-store');
    expect(terminal.match(/#EXT-X-ENDLIST/g)).toHaveLength(1);
    expect(terminal).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(await read(key.vod, vodPolicy)).toBe(terminal);
    const master = await read(key.vodMaster, vodPolicy);
    expect(master).not.toContain('ENDLIST');
    const rendition = master.split('\n').find((line) => line !== '' && !line.startsWith('#'));
    expect(rendition).toBe('manifest-720p.m3u8');
    const renditionUrl = new URL(rendition ?? '', `${publicBase}/${key.vodMaster}`).href;
    expect(renditionUrl).toBe(`${publicBase}/${key.vod}`);
    const response = await fetch(renditionUrl, { signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(terminal);
    const decoded = spawnSync(
      ffmpeg,
      [
        '-nostdin',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'http,https,tcp,tls,crypto',
        '-i',
        `${publicBase}/${key.vodMaster}`,
        '-map',
        '0:v:0',
        '-f',
        'null',
        '-',
      ],
      { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 }
    );
    if (decoded.error) {
      throw decoded.error;
    }
    expect(decoded.status, decoded.stderr.toString()).toBe(0);
    await service.convertM3u8DynamicManifestsToStatic(config, 'recorded', ['720p']);
    expect((await read(key.dynamic, 'no-store')).match(/#EXT-X-ENDLIST/g)).toHaveLength(1);
  });

  it('propagates a real missing-rendition error before publishing the VOD master and recovers on retry', async () => {
    const key = await seed('retry');
    await expect(
      service.convertM3u8DynamicManifestsToStatic(config, 'retry', ['720p', '480p'])
    ).rejects.toThrow();
    await expect(
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: key.vodMaster }))
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    const missing = keys('retry', '480p');
    await service.putObjectFromData(
      config,
      missing.dynamic,
      Readable.from([
        `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n../../720p/segments/segment-run-one-0.ts\n`,
      ]),
      contentType
    );
    await service.convertM3u8DynamicManifestsToStatic(config, 'retry', ['720p', '480p']);
    expect(await read(key.vodMaster, vodPolicy)).not.toContain('ENDLIST');
    expect((await read(key.dynamic, 'no-store')).match(/ENDLIST/g)).toHaveLength(1);
    expect(await read(missing.dynamic, 'no-store')).toContain('ENDLIST');
  });

  it('resumes the same video with fresh live metadata and distinct segment content after real cleanup', async () => {
    const key = await seed('resume');
    await service.convertM3u8DynamicManifestsToStatic(config, 'resume', ['720p']);
    expect(await read(key.dynamic, 'no-store')).toContain('ENDLIST');
    await service.deleteDirectoryRecursive(config, key.prefix);
    await expect(
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: key.segment }))
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    const segment = key.segment.replace('run-one', 'run-two');
    await service.putObjectFromData(config, segment, resumedSegment, 'video/mp2t');
    await service.putObjectFromData(
      config,
      key.dynamic,
      Buffer.from(`#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${publicBase}/${segment}\n`),
      contentType
    );
    const live = await read(key.dynamic, livePolicy);
    expect(live).not.toContain('ENDLIST');
    expect(live).not.toContain('run-one');
    const response = await fetch(`${publicBase}/${segment}`, { signal: AbortSignal.timeout(5000) });
    expect(response.headers.get('cache-control')).toBe(vodPolicy);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(resumedSegment);
    expect(resumedSegment).not.toEqual(firstSegment);
  });
});
