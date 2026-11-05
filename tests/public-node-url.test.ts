import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { VideoPublishService } from '../src/services/video-publish.js';
import { SettingsController } from '../src/controllers/settings.js';
import { isValidPublicHost } from '../src/utils/public-host.js';

it.each([
  'https://host.test',
  'host/path',
  'user@host',
  'host:443',
  'host?x',
  'host#x',
  ' ',
  'host\n#EXT-X-ENDLIST',
  '999.1.1.1',
])('rejects malformed host %s', (value) => {
  expect(isValidPublicHost(value)).toBe(false);
});

it('validates before forwarding public settings and trims valid hosts', async () => {
  const setExternalNetwork = vi.fn().mockResolvedValue({ isError: false });
  const controller = new SettingsController(
    {} as never,
    { setExternalNetwork } as never,
    {} as never,
    {} as never
  );
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: 'test-token' } as typeof request.session;
    done();
  });
  app.post('/settings/node/network/external', controller.apiSetNetworkExternal);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/settings/node/network/external',
      payload: {
        publicNodeProtocol: 'https',
        publicNodeAddress: 'https://host.test',
        publicNodePort: 443,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(setExternalNetwork).not.toHaveBeenCalled();
    await app.inject({
      method: 'POST',
      url: '/settings/node/network/external',
      payload: {
        publicNodeProtocol: 'https',
        publicNodeAddress: ' host.test ',
        publicNodePort: 443,
      },
    });
    expect(setExternalNetwork).toHaveBeenCalledWith('test-token', 'https', 'host.test', 443);
  } finally {
    await app.close();
  }
});

type Job = Parameters<VideoPublishService['enqueuePendingPublishVideo']>[0];
it.each(['filesystem', 's3provider'] as const)(
  'repairs recovered HLS URLs with %s storage, including completed uploads',
  async (storageMode) => {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'moartube-public-url-'));
    const directory = path.join(root, 'video123', 'adaptive', 'm3u8');
    fs.mkdirSync(directory, { recursive: true });
    const manifest = path.join(directory, 'manifest-720p.m3u8');
    const tail = '/external/videos/video123/adaptive/m3u8/720p/segments/segment-720p-0.ts';
    const original =
      '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:2,\nhttps://old.test/bucket' +
      tail +
      '\n#EXT-X-ENDLIST\n';
    let uploaded = '';
    let currentBase = 'http://new.test:8080/new-bucket';
    const setVideoPublishing = vi.fn().mockResolvedValue({ isError: false });
    const upload = vi.fn(
      (
        _token: unknown,
        _id: unknown,
        _format: unknown,
        _resolution: unknown,
        files: { filePath: string }[]
      ) => {
        uploaded = fs.readFileSync(files[0]?.filePath ?? '', 'utf8');
        return Promise.resolve();
      }
    );
    const uploadS3 = vi.fn((_config: unknown, files: { filePath: string }[]) => {
      uploaded = fs.readFileSync(files[0]?.filePath ?? '', 'utf8');
      return Promise.resolve();
    });
    const service = new VideoPublishService(
      { info: vi.fn(), error: vi.fn() } as never,
      {
        setVideoPublishing,
        getExternalVideosBaseUrl: () => Promise.resolve(currentBase),
        getNodeSettings: () => Promise.resolve({ storageConfig: { storageMode, s3Config: {} } }),
        uploadVideo: upload,
        withVideoCacheInvalidation: (
          _token: string,
          _id: string,
          _paths: string[],
          operation: () => Promise<void>
        ) => operation(),
      } as never,
      { uploadFilesWithProgress: uploadS3 } as never,
      {
        getVideosDirectoryPath: () => root,
        getClientSettings: () => ({
          nodeHttpProtocol: 'http',
          nodeIp: 'localhost',
          nodePort: 3000,
        }),
      } as never,
      { broadcastToUser: vi.fn() } as never,
      {} as never,
      {} as never
    );
    const internal = service as unknown as { startPublishingJob(job: Job): Promise<void> };
    let checkedUploadFailure = false;
    try {
      for (const savedState of [
        { uploadCompleted: false },
        { uploadCompleted: true },
        { uploadCompleted: true, externalVideosBaseUrl: 'https://old.test/bucket' },
        { uploadCompleted: true, externalVideosBaseUrl: 'https://latest.test' },
      ]) {
        fs.writeFileSync(manifest, original);
        const job: Job = {
          jwtToken: 'test',
          videoId: 'video123',
          format: 'm3u8',
          resolution: '720p',
          sourceFileExtension: '.mp4',
          encodingCompleted: true,
          ...savedState,
          connection: JSON.stringify(['http', 'localhost', 3000]),
        };
        await expect(
          internal.startPublishingJob({ ...job, connection: 'different-node' })
        ).rejects.toThrow('original Node connection');
        expect(fs.readFileSync(manifest, 'utf8')).toBe(original);
        if (!checkedUploadFailure) {
          const uploader = storageMode === 'filesystem' ? upload : uploadS3;
          uploader.mockRejectedValueOnce(new Error('Upload interrupted'));
          await expect(internal.startPublishingJob(job)).rejects.toThrow('Upload interrupted');
          expect(job.uploadCompleted).toBe(false);
          expect(job.manifestUrlVersion).toBeUndefined();
          const receipt = fs.readdirSync(path.join(root, '.publish-recovery'))[0];
          const failedReceipt = JSON.parse(
            fs.readFileSync(path.join(root, '.publish-recovery', receipt ?? ''), 'utf8')
          ) as { uploadCompleted: boolean };
          expect(failedReceipt.uploadCompleted).toBe(false);
          checkedUploadFailure = true;
        }
        await internal.startPublishingJob(job);
        expect(uploaded).toBe(
          original.replace(
            'https://old.test/bucket' + tail,
            '../../720p/segments/segment-720p-0.ts'
          )
        );
        expect(job.externalVideosBaseUrl).toBe(currentBase);
        expect(job.manifestUrlVersion).toBe(1);
        const receipts = fs.readdirSync(path.join(root, '.publish-recovery'));
        expect(
          (
            JSON.parse(
              fs.readFileSync(path.join(root, '.publish-recovery', receipts[0] ?? ''), 'utf8')
            ) as { externalVideosBaseUrl: string }
          ).externalVideosBaseUrl
        ).toBe(currentBase);
        upload.mockClear();
        uploadS3.mockClear();
        await internal.startPublishingJob(job);
        expect(upload).not.toHaveBeenCalled();
        expect(uploadS3).not.toHaveBeenCalled();
        currentBase = 'https://latest.test';
      }
      expect(setVideoPublishing).toHaveBeenCalledTimes(9);
    } finally {
      service.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

it('formats IPv6 links and refreshes previously open pages after a public URL change', () => {
  const listeners: Record<string, (event?: { key: string }) => void> = {};
  let stored: string | null = null;
  const reload = vi.fn();
  const window = {
    addEventListener: (event: string, listener: () => void) => {
      listeners[event] = listener;
    },
    location: { reload },
  } as unknown as {
    MoarTubePublicNodeUrl: { build(settings: object): string; changed(settings: object): void };
  };
  vm.runInNewContext(fs.readFileSync('public/javascript/public-node-url.js', 'utf8'), {
    window,
    document: { hasFocus: () => false },
    localStorage: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  });
  const settings = {
    publicNodeProtocol: 'https',
    publicNodeAddress: '2001:db8::1',
    publicNodePort: '443',
  };
  expect(window.MoarTubePublicNodeUrl.build(settings)).toBe('https://[2001:db8::1]');
  expect(
    window.MoarTubePublicNodeUrl.build({
      ...settings,
      publicNodeAddress: '[2001:db8::1]',
      publicNodePort: 8443,
    })
  ).toBe('https://[2001:db8::1]:8443');
  window.MoarTubePublicNodeUrl.changed(settings);
  listeners.focus?.();
  expect(reload).not.toHaveBeenCalled();
  stored = 'changed by another tab';
  listeners.focus?.();
  expect(reload).toHaveBeenCalledOnce();
});
