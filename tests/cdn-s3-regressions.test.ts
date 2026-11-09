import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Service, type S3ValidationConfig } from '../src/services/s3.js';
import { Logger } from '../src/utils/logger.js';
import { siloFixture, siloProxy, type SiloFixture } from './support/silo.js';

const prefix = 'external/videos/id/adaptive/m3u8/';
const media =
  '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:2,\nsegment.ts\n';
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nmanifest-720p.m3u8\n';
let fixture: SiloFixture;
let proxy: Awaited<ReturnType<typeof siloProxy>>;
let config: S3ValidationConfig;
let service: S3Service;
let failedKey: string | undefined;
let writes: string[];
beforeEach(async () => {
  fixture = await siloFixture();
  writes = [];
  failedKey = undefined;
  proxy = await siloProxy(
    fixture.config.s3ProviderClientConfig.endpoint,
    (req) => {
      const key = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').slice(
        fixture.config.bucketName.length + 2
      );
      if (req.method === 'PUT' && key === failedKey) {
        req.headers.authorization = req.headers.authorization?.replace(
          /Signature=[a-f0-9]+/,
          'Signature=0'
        );
      }
    },
    (req, response, output) => {
      if (req.method === 'PUT' && response.statusCode === 200) {
        output.once('finish', () => {
          writes.push(
            decodeURIComponent((req.url ?? '').split('?')[0] ?? '').slice(
              fixture.config.bucketName.length + 2
            )
          );
        });
      }
    }
  );
  config = {
    ...fixture.config,
    s3ProviderClientConfig: { ...fixture.config.s3ProviderClientConfig, endpoint: proxy.endpoint },
  };
  service = new S3Service(new Logger({}, pino({ level: 'silent' })));
  await fixture.put(prefix + 'dynamic/manifests/manifest-720p.m3u8', media);
  await fixture.put(prefix + 'dynamic/manifests/manifest-master.m3u8', master);
});
afterEach(async () => {
  service.close();
  await proxy.close();
  await fixture.close();
});
describe('S3 HLS lifecycle against Silo', () => {
  it('publishes renditions before master and retains terminal dynamic media, idempotently', async () => {
    await service.convertM3u8DynamicManifestsToStatic(config, 'id', ['720p']);
    expect(writes).toEqual([
      prefix + 'static/manifests/manifest-720p.m3u8',
      prefix + 'dynamic/manifests/manifest-720p.m3u8',
      prefix + 'static/manifests/manifest-master.m3u8',
    ]);
    const terminal = await fixture.text(prefix + 'dynamic/manifests/manifest-720p.m3u8');
    expect(terminal).toContain('ENDLIST');
    const head = await fixture.client.send(
      new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: prefix + 'dynamic/manifests/manifest-720p.m3u8',
      })
    );
    expect(head.CacheControl).toBe('no-store');
    const vod = await fixture.text(prefix + 'static/manifests/manifest-master.m3u8');
    expect(vod).toContain('\nmanifest-720p.m3u8\n');
    expect(vod).not.toContain('ENDLIST');
    await service.convertM3u8DynamicManifestsToStatic(config, 'id', ['720p']);
    expect(
      (await fixture.text(prefix + 'static/manifests/manifest-720p.m3u8')).match(/#EXT-X-ENDLIST/g)
    ).toHaveLength(1);
  });
  it('propagates a real rejected rendition write and never publishes its master', async () => {
    failedKey = prefix + 'static/manifests/manifest-720p.m3u8';
    await expect(
      service.convertM3u8DynamicManifestsToStatic(config, 'id', ['720p'])
    ).rejects.toThrow();
    expect(writes).toEqual([]);
    await expect(
      fixture.client.send(
        new HeadObjectCommand({
          Bucket: config.bucketName,
          Key: prefix + 'static/manifests/manifest-master.m3u8',
        })
      )
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await fixture.text(prefix + 'dynamic/manifests/manifest-720p.m3u8')).toBe(media);
  });
});
