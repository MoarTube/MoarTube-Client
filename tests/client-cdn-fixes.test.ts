import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { NodeApiService } from '../src/services/node-api.js';
import { NodeActions } from '../src/utils/node-actions.js';
import { VideosController } from '../src/controllers/videos.js';
import { VideoPublishService } from '../src/services/video-publish.js';
import { VideoImportService } from '../src/services/video-import.js';
import { SettingsController } from '../src/controllers/settings.js';
import { S3Service } from '../src/services/s3.js';
import { siloFixture, siloProxy } from './support/silo.js';
import * as images from '../src/utils/images.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
let root: string, app: FastifyInstance, api: NodeApiService, config: any;
let rejected: string | undefined;
let calls: { route: string; body: any }[];
const reply = () => ({ status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() });
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(tmpdir(), 'moartube-client-cdn-'));
  rejected = undefined;
  calls = [];
  app = Fastify();
  app.addContentTypeParser(/^multipart\/form-data/, { parseAs: 'buffer' }, (_request, body, done) =>
    done(null, body)
  );
  app.post('/*', async (request, output) => {
    calls.push({ route: request.url, body: request.body });
    if (request.url.includes('/malformed/')) return 'unexpected response';
    if (request.url === rejected)
      return output.code(200).send({ isError: true, message: 'test rejection' });
    return request.url === '/streams/start'
      ? { isError: false, videoId: 'video123' }
      : { isError: false };
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  config = {
    paths: { data: root },
    clientSettings: {
      nodeHttpProtocol: 'http',
      nodeIp: '127.0.0.1',
      nodePort: (app.server.address() as { port: number }).port,
    },
  };
  api = new NodeApiService(logger as never, config);
});
afterEach(async () => {
  vi.useRealTimers();
  api.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe('Client CDN remediation', () => {
  it('keeps Node import activity until the canceled import request has drained', async () => {
    const stopVideoImporting = vi.fn().mockResolvedValue({ isError: false });
    const importing = new VideoImportService(
      logger as never,
      {} as never,
      { stopVideoImporting } as never,
      { broadcastToUser: vi.fn() } as never,
      {} as never,
      {} as never
    );
    importing.beginImport('video123');
    const stopping = importing.stopImporting('token', 'video123');
    await Promise.resolve();
    expect(stopVideoImporting).not.toHaveBeenCalled();
    importing.endImport('video123');
    await stopping;
    expect(stopVideoImporting).toHaveBeenCalledWith('token', 'video123');
  });

  it('never starts direct storage writes when Node activity admission fails', async () => {
    rejected = '/videos/video123/activity';
    const write = vi.fn();
    await expect(
      api.withVideoCacheInvalidation('token', 'video123', ['images/poster.jpg'], write)
    ).rejects.toThrow('test rejection');
    expect(write).not.toHaveBeenCalled();
    expect(calls.map((call) => call.route)).toEqual([
      '/videos/video123/activity',
      '/videos/video123/cache/invalidate',
    ]);
  });

  it('does not automatically acknowledge an uncertain direct write after the owning Client dies', async () => {
    const folder = path.join(root, 'node-actions');
    const actions = new NodeActions(folder);
    const action = actions.prepare(
      'http://node',
      'token',
      '/videos/video/cache/invalidate',
      { paths: ['images/poster.jpg'], activityId: 'activity' },
      'video',
      true
    );
    action.owner = 1073741823;
    await writeFile(path.join(folder, action.id + '.json'), JSON.stringify(action));
    const restarted = new NodeActions(folder);
    const send = vi.fn();
    await restarted.replay(send);
    expect(send).not.toHaveBeenCalled();
    expect(restarted.pending()[0]?.state).toBe('writing');
  });

  it('blocks resume only for the video with an unreconciled previous session', async () => {
    const options = {
      title: 'live',
      description: '',
      tags: '',
      rtmpPort: 1935,
      uuid: 'key',
      resolution: '720p',
      isRecordingStreamRemotely: false,
      isRecordingStreamLocally: false,
      networkAddress: '127.0.0.1',
    };
    await api.streamVideo('token', options);
    await expect(api.streamVideo('token', { ...options, videoId: 'video123' })).rejects.toThrow(
      'previous stream'
    );
    await expect(
      api.streamVideo('token', { ...options, videoId: 'different' })
    ).resolves.toMatchObject({ isError: false });
  });
  it('does not acknowledge an invalid success envelope', async () => {
    await expect(api.setVideoPublished('token', 'malformed')).resolves.toEqual({ isError: false });
    await expect(
      api.setVideoFormatResolutionPublished('token', 'malformed', 'mp4', '720p')
    ).rejects.toThrow('Invalid Node mutation response');
    expect(new NodeActions(path.join(root, 'node-actions')).pending()).toHaveLength(1);
  });

  it('rejects malformed recorded and live upload acknowledgments', async () => {
    const filePath = path.join(root, 'output.mp4');
    await writeFile(filePath, 'media bytes');
    await expect(
      api.uploadVideo('token', 'malformed', 'mp4', '720p', [
        { fileName: '720p.mp4', filePath, contentType: 'video/mp4' },
      ])
    ).rejects.toThrow('Invalid Node mutation response');
    await expect(
      api.uploadStream('token', {
        videoId: 'malformed',
        format: 'm3u8',
        resolution: '720p',
        manifestBuffer: Buffer.from('#EXTM3U'),
        segmentBuffer: Buffer.from('segment'),
        manifestFileName: 'manifest-720p.m3u8',
        segmentFileName: 'run-1.ts',
      })
    ).rejects.toThrow('Invalid Node mutation response');
  });

  it('withdrawal cancels the matching pending output without republishing it later', async () => {
    rejected = '/videos/video123/published';
    await expect(
      api.setVideoFormatResolutionPublished('token', 'video123', 'mp4', '720p')
    ).rejects.toThrow();
    await expect(
      api.setVideoFormatResolutionPublished('token', 'video123', 'webm', '720p')
    ).rejects.toThrow();
    await api.unpublishVideo('token', 'video123', 'mp4', '720p');
    rejected = undefined;
    calls = [];
    await api.retryPendingActions();
    expect(calls).toEqual([
      { route: '/videos/video123/published', body: { format: 'webm', resolution: '720p' } },
    ]);
  });
  it.each([false, true])(
    'recovers encoded output after restart without encoding again (uploaded=%s)',
    async (uploaded) => {
      vi.useFakeTimers();
      const settings = {
        getVideosDirectoryPath: () => root,
        getClientSettings: () => config.clientSettings,
      };
      const node = {
        setVideoPublishing: vi.fn().mockResolvedValue({ isError: false }),
        setVideoFormatResolutionPublished: vi.fn().mockResolvedValue({ isError: false }),
      };
      const create = () =>
        new VideoPublishService(
          logger as never,
          node as never,
          {} as never,
          settings as never,
          { broadcastToUser: vi.fn() } as never,
          {} as never,
          {} as never
        );
      const previous = create();
      const job = {
        jwtToken: 'token',
        videoId: 'video123',
        format: 'mp4',
        resolution: '720p',
        sourceFileExtension: '.mp4',
        encodingCompleted: true,
        uploadCompleted: uploaded,
        connection: JSON.stringify(['http', '127.0.0.1', config.clientSettings.nodePort]),
      };
      (previous as any).checkpoint(job);
      previous.close();
      const recovered = create();
      const encode = vi.spyOn(recovered as any, 'performEncodingJob').mockResolvedValue(undefined);
      const upload = vi.spyOn(recovered as any, 'performUploadingJob').mockResolvedValue(undefined);
      try {
        await vi.advanceTimersByTimeAsync(3000);
        expect(encode).not.toHaveBeenCalled();
        expect(upload).toHaveBeenCalledTimes(uploaded ? 0 : 1);
        expect(node.setVideoFormatResolutionPublished).toHaveBeenCalled();
        await vi.waitFor(async () =>
          expect(await readdir(path.join(root, '.publish-recovery'))).toEqual([])
        );
      } finally {
        recovered.close();
      }
    }
  );
  it('keeps overlapping writes to the same S3 key independently recoverable', async () => {
    let finish!: () => void;
    const first = api.withVideoCacheInvalidation(
      'token',
      'video123',
      ['images/preview.jpg'],
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await api.withVideoCacheInvalidation(
      'token',
      'video123',
      ['images/preview.jpg'],
      async () => {}
    );
    expect(new NodeActions(path.join(root, 'node-actions')).pending()).toHaveLength(1);
    finish();
    await first;
    expect(calls).toHaveLength(4);
    expect(new NodeActions(path.join(root, 'node-actions')).pending()).toEqual([]);
  });
  it.each([false, true])(
    'restarts through the old port before changing Client connection settings (restart rejected=%s)',
    async (fail) => {
      config.clientSettings.nodePort = 9090;
      config.saveClientSettings = (settings: unknown) => {
        config.clientSettings = settings;
      };
      const restart = vi.fn(async () => {
        expect(config.clientSettings.nodePort).toBe(9090);
        return { isError: fail, message: 'restart rejected' };
      });
      const controller = new SettingsController(
        config,
        { setNetworkInternal: async () => ({ isError: false }), restartNode: restart } as never,
        {} as never,
        {} as never
      );
      const output = reply();
      await controller.apiSetNetworkInternal(
        { body: { nodeListeningPort: 8080 }, session: { jwtToken: 'token' } } as never,
        output as never
      );
      expect(config.clientSettings.nodePort).toBe(fail ? 9090 : 8080);
      expect(output.send.mock.calls[0]?.[0].isError).toBe(fail);
    }
  );

  it('shows the Node busy-work rejection without attempting a restart', async () => {
    const restartNode = vi.fn();
    const controller = new SettingsController(
      config,
      {
        databaseConfigToggle: async () => {
          throw new Error(
            'Stop or finish all imports, publishing jobs, uploads, and live streams before switching databases.'
          );
        },
        restartNode,
      } as never,
      {} as never,
      {} as never
    );
    const output = reply();
    await controller.apiToggleDatabase(
      { body: { databaseConfig: {} }, session: { jwtToken: 'token' } } as never,
      output as never
    );
    expect(output.send.mock.calls[0]?.[0]).toMatchObject({
      isError: true,
      message: expect.stringContaining('Stop or finish all imports'),
    });
    expect(restartNode).not.toHaveBeenCalled();
  });

  it('passes through the full-restart requirement without requesting a worker-only restart', async () => {
    const response = {
      isError: false,
      restartRequired: true,
      message: 'Restart MoarTube Node before continuing.',
    };
    const restartNode = vi.fn();
    const controller = new SettingsController(
      config,
      { databaseConfigToggle: async () => response, restartNode } as never,
      {} as never,
      {} as never
    );
    const output = reply();
    await controller.apiToggleDatabase(
      { body: { databaseConfig: {} }, session: { jwtToken: 'token' } } as never,
      output as never
    );
    expect(output.send).toHaveBeenCalledWith(response);
    expect(restartNode).not.toHaveBeenCalled();
  });

  it('reports saved database settings as activation pending when restart is rejected', async () => {
    const controller = new SettingsController(
      config,
      {
        databaseConfigToggle: async () => ({ isError: false }),
        restartNode: async () => ({ isError: true }),
      } as never,
      {} as never,
      {} as never
    );
    const output = reply();
    await controller.apiToggleDatabase(
      { body: { databaseConfig: {} }, session: { jwtToken: 'token' } } as never,
      output as never
    );
    expect(output.send.mock.calls[0]?.[0]).toMatchObject({
      isError: true,
      message: expect.stringContaining('activation is pending'),
    });
  });
  it('reports a semantic mutation rejection and does not journal rejected publishing admission', async () => {
    rejected = '/videos/publishing';
    await expect(api.setVideoPublishing('token', 'video123')).rejects.toThrow('test rejection');
    expect(new NodeActions(path.join(root, 'node-actions')).pending()).toEqual([]);
  });

  it('notifies only after storage writes, and retries against the original Node after selection changes', async () => {
    rejected = '/videos/video123/cache/invalidate';
    let committed = false;
    await expect(
      api.withVideoCacheInvalidation('token', 'video123', ['images/preview.jpg'], async () => {
        committed = true;
      })
    ).rejects.toThrow('queued');
    expect(committed).toBe(true);
    expect(calls[0]?.route).toBe('/videos/video123/activity');
    expect(calls[1]).toEqual({
      route: '/videos/video123/cache/invalidate',
      body: { paths: ['images/preview.jpg'], activityId: expect.any(String) },
    });
    api.close();
    config.clientSettings.nodePort = 1;
    rejected = undefined;
    api = new NodeApiService(logger as never, config);
    await api.retryPendingActions();
    expect(calls).toHaveLength(3);
    expect(await readdir(path.join(root, 'node-actions'))).toEqual([]);
  });

  it('invalidates partial writes while preserving the original storage failure', async () => {
    await expect(
      api.withVideoCacheInvalidation('token', 'video123', ['images/poster.jpg'], async () => {
        throw new Error('partial write');
      })
    ).rejects.toThrow('partial write');
    expect(calls[1]?.route).toBe('/videos/video123/cache/invalidate');
  });

  it('does not replay before a write finishes, but recovers an interrupted writing intent', async () => {
    const journal = new NodeActions(path.join(root, 'journal'));
    const action = journal.prepare(
      'http://test',
      'token',
      '/videos/video123/cache/invalidate',
      { paths: ['images/poster.jpg'] },
      'scope',
      true
    );
    const send = vi.fn().mockResolvedValue({ isError: false });
    await journal.replay(send);
    expect(send).not.toHaveBeenCalled();
    await new NodeActions(path.join(root, 'journal')).replay(send);
    expect(send).toHaveBeenCalledWith(action);
    expect(journal.pending()).toEqual([]);
  });

  it('an older acknowledgment cannot erase a newer invalidation', async () => {
    const journal = new NodeActions(path.join(root, 'journal'));
    const first = journal.prepare('http://test', 'token', '/invalidate', {}, 'scope');
    let finish!: (value: unknown) => void;
    const sending = journal.deliver(
      first,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const newer = journal.prepare('http://test', 'token', '/invalidate', {}, 'scope');
    finish({ isError: false });
    await sending;
    expect(journal.pending()[0]?.token).toBe(newer.token);
  });

  it('replays output confirmation and final publication in order without encoding again', async () => {
    rejected = '/videos/published';
    await expect(
      api.setVideoFormatResolutionPublished('token', 'video123', 'mp4', '720p', true)
    ).rejects.toThrow();
    api.close();
    rejected = undefined;
    api = new NodeApiService(logger as never, config);
    await api.retryPendingActions();
    expect(calls.map(({ route }) => route)).toEqual([
      '/videos/video123/published',
      '/videos/published',
      '/videos/video123/published',
      '/videos/published',
    ]);
  });

  it('publication cancellation removes deferred publication but retains cache reconciliation', async () => {
    rejected = '/videos/published';
    await expect(
      api.setVideoFormatResolutionPublished('token', 'video123', 'mp4', '720p', true)
    ).rejects.toThrow();
    await api.stopVideoPublishing('token', 'video123');
    rejected = undefined;
    calls = [];
    await api.retryPendingActions();
    expect(calls).toEqual([]);
  });

  it('recovers a crashed live session without stopping an active session during normal retries', async () => {
    await api.streamVideo('token', {
      title: 'live',
      description: '',
      tags: '',
      rtmpPort: 1935,
      uuid: 'key',
      resolution: '720p',
      isRecordingStreamRemotely: false,
      isRecordingStreamLocally: false,
      networkAddress: '127.0.0.1',
    });
    await api.retryPendingActions();
    expect(calls.map(({ route }) => route)).toEqual(['/streams/start']);
    api.close();
    api = new NodeApiService(logger as never, config);
    await api.retryPendingActions();
    expect(calls.at(-1)?.route).toBe('/streams/video123/stop');
  });

  it('never reports a filesystem image rejection as success', async () => {
    const imageProcessing = vi
      .spyOn(images, 'renderImages')
      .mockResolvedValue([Buffer.from('encoded image')]);
    const setPreview = vi.fn().mockResolvedValue({ isError: true, message: 'rejected image' });
    const controller = new VideosController(
      {
        getNodeSettings: async () => ({ storageConfig: { storageMode: 'filesystem' } }),
        setPreview,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getPath: () => 'ffmpeg' } as never
    );
    const output = reply();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64'
    );
    await controller.postPreview(
      {
        session: { jwtToken: 'token' },
        params: { videoId: 'video123' },
        file: async () => ({ toBuffer: async () => png }),
      } as never,
      output as never
    );
    expect(output.send.mock.calls[0]?.[0]).toMatchObject({ isError: true });
    expect(setPreview).toHaveBeenCalledOnce();
    imageProcessing.mockRestore();
  });

  it('does not encode after rejected admission and retries uploaded confirmation without re-encoding', async () => {
    vi.useFakeTimers();
    const node = {
      setVideoPublishing: vi.fn().mockResolvedValue({ isError: true, message: 'admission denied' }),
      setVideoFormatResolutionPublished: vi.fn().mockResolvedValue({ isError: false }),
    };
    const publish = new VideoPublishService(
      logger as never,
      node as never,
      {} as never,
      { getVideosDirectoryPath: () => root } as never,
      { broadcastToUser: vi.fn() } as never,
      {} as never,
      {} as never
    );
    const internal = publish as any;
    const encode = vi.spyOn(internal, 'performEncodingJob').mockResolvedValue(undefined);
    const upload = vi.spyOn(internal, 'performUploadingJob').mockResolvedValue(undefined);
    try {
      publish.enqueuePendingPublishVideo({
        jwtToken: 'token',
        videoId: 'video123',
        format: 'mp4',
        resolution: '720p',
        sourceFileExtension: '.mp4',
      });
      await vi.advanceTimersByTimeAsync(3000);
      expect(encode).not.toHaveBeenCalled();
      expect(node.setVideoFormatResolutionPublished).not.toHaveBeenCalled();
      node.setVideoPublishing.mockResolvedValue({ isError: false } as never);
      node.setVideoFormatResolutionPublished.mockResolvedValueOnce({
        isError: true,
        message: 'offline',
      } as never);
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(encode).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledTimes(1);
      expect(node.setVideoFormatResolutionPublished).toHaveBeenLastCalledWith(
        'token',
        'video123',
        'mp4',
        '720p',
        true
      );
    } finally {
      publish.close();
    }
  });

  it('uploads every S3 segment before publishing the recorded playlist', async () => {
    const fixture = await siloFixture();
    const order: string[] = [];
    const proxy = await siloProxy(fixture.config.s3ProviderClientConfig.endpoint, (request) => {
      if (request.method === 'PUT')
        order.push(new URL(request.url ?? '/', 'http://fixture').pathname);
    });
    const storage = new S3Service(logger as never);
    try {
      await writeFile(path.join(root, 'playlist'), '#EXTM3U\n');
      await writeFile(path.join(root, 'segment'), 'bytes');
      await storage.uploadFilesWithProgress(
        {
          ...fixture.config,
          s3ProviderClientConfig: {
            ...fixture.config.s3ProviderClientConfig,
            endpoint: proxy.endpoint,
          },
        },
        [
          {
            key: 'recorded/manifest.m3u8',
            filePath: path.join(root, 'playlist'),
            contentType: 'application/vnd.apple.mpegurl',
          },
          { key: 'recorded/1.ts', filePath: path.join(root, 'segment'), contentType: 'video/mp2t' },
          { key: 'recorded/2.ts', filePath: path.join(root, 'segment'), contentType: 'video/mp2t' },
        ],
        () => {}
      );
      expect(order.at(-1)).toContain('manifest.m3u8');
      expect(order.slice(0, -1).every((key) => key.endsWith('.ts'))).toBe(true);
    } finally {
      storage.close();
      await proxy.close();
      await fixture.close();
    }
  });
});
