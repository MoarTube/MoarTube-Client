import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import pino from 'pino';
import { S3Service } from '../src/services/s3.js';
import { Logger } from '../src/utils/logger.js';
import { siloFixture, siloProxy, type SiloFixture } from './support/silo.js';

let fixture: SiloFixture;
let service: S3Service;
beforeEach(async () => {
  fixture = await siloFixture();
  service = new S3Service(new Logger({}, pino({ level: 'silent' })));
});
afterEach(async () => {
  service.close();
  await fixture.close();
});
async function policy(key: string): Promise<string | undefined> {
  return (
    await fixture.client.send(
      new HeadObjectCommand({ Bucket: fixture.config.bucketName, Key: key })
    )
  ).CacheControl;
}
describe('S3 upload policies and shared budget against Silo', () => {
  it.each([false, true])(
    'does not interrupt an active upload when validating another configuration (invalid=%s)',
    async (invalid) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered = false;
      const proxy = await siloProxy(fixture.config.s3ProviderClientConfig.endpoint, async (req) => {
        if (req.method === 'PUT') {
          entered = true;
          await gate;
        }
      });
      const activeConfig = {
        ...fixture.config,
        s3ProviderClientConfig: {
          ...fixture.config.s3ProviderClientConfig,
          endpoint: proxy.endpoint,
        },
      };
      const upload = service.putObjectFromData(
        activeConfig,
        'active-upload',
        Buffer.from('complete upload'),
        'text/plain'
      );
      const settled = Promise.allSettled([upload]);
      try {
        await vi.waitFor(() => {
          expect(entered).toBe(true);
        });
        const active = (service as unknown as { client: S3Client }).client;
        const destroy = vi.spyOn(active, 'destroy');
        const candidate = {
          ...fixture.config,
          s3ProviderClientConfig: {
            ...fixture.config.s3ProviderClientConfig,
            credentials: {
              ...fixture.config.s3ProviderClientConfig.credentials,
              ...(invalid ? { secretAccessKey: 'invalid-test-secret' } : {}),
            },
          },
        };
        if (invalid) {
          await expect(service.validateS3Config(candidate)).rejects.toThrow();
        } else {
          await service.validateS3Config(candidate);
        }
        expect(destroy).not.toHaveBeenCalled();
        release();
        await upload;
        expect(await fixture.text('active-upload')).toBe('complete upload');
      } finally {
        release();
        await settled;
        await proxy.close();
      }
    }
  );
  it('persists live-image and playlist cache metadata in real objects', async () => {
    const image = 'external/videos/id/images/preview.jpg';
    const live = 'external/videos/id/adaptive/m3u8/dynamic/manifests/live.m3u8';
    await Promise.all([
      service.putObjectFromData(fixture.config, image, Buffer.from('image'), 'image/jpeg'),
      service.putObjectFromData(
        fixture.config,
        live,
        Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nsegment.ts\n'),
        'application/vnd.apple.mpegurl'
      ),
    ]);
    expect(await policy(image)).toBe('public, max-age=0, s-maxage=30, must-revalidate');
    expect(await policy(live)).toBe('public, max-age=0, s-maxage=1, must-revalidate');
  });
  it('replaces terminal metadata when the same playlist resumes', async () => {
    const key = 'external/videos/id/adaptive/m3u8/dynamic/manifests/manifest-720p.m3u8';
    for (const terminalPlaylist of [false, true, false]) {
      await service.putObjectFromData(
        fixture.config,
        key,
        Buffer.from(
          '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nsegment.ts\n' +
            (terminalPlaylist ? '#EXT-X-ENDLIST\n' : '')
        ),
        'application/vnd.apple.mpegurl',
        undefined,
        { terminalPlaylist }
      );
      const head = await fixture.client.send(
        new HeadObjectCommand({ Bucket: fixture.config.bucketName, Key: key })
      );
      expect(head.Metadata?.['moartube-live-playlist']).toBe(
        terminalPlaylist ? undefined : 'active'
      );
      expect(await policy(key)).toBe(
        terminalPlaylist ? 'no-store' : 'public, max-age=0, s-maxage=1, must-revalidate'
      );
    }
  });
  it('limits six real concurrent uploads to four', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const proxy = await siloProxy(fixture.config.s3ProviderClientConfig.endpoint, async (req) => {
      if (req.method === 'PUT') {
        entered++;
        await gate;
      }
    });
    const config = {
      ...fixture.config,
      s3ProviderClientConfig: {
        ...fixture.config.s3ProviderClientConfig,
        endpoint: proxy.endpoint,
      },
    };
    const jobs = Array.from({ length: 6 }, (_, i) =>
      service.putObjectFromData(
        config,
        String(i),
        Buffer.alloc(1024, i),
        'application/octet-stream'
      )
    );
    try {
      const deadline = Date.now() + 5000;
      while (entered < 4 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(entered).toBe(4);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(entered).toBe(4);
      release();
      await Promise.all(jobs);
      expect(entered).toBe(6);
      for (let i = 0; i < 6; i++) {
        expect((await fixture.text(String(i))).length).toBe(1024);
      }
    } finally {
      release();
      await Promise.allSettled(jobs);
      await proxy.close();
    }
  });
});
