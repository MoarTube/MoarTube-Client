import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { NodeApiService } from '../../src/services/node-api.js';
import { CommentsController as ClientComments } from '../../src/controllers/comments.js';
import { VideosController as ClientVideos } from '../../src/controllers/videos.js';
import { ManifestService as ClientManifests } from '../../src/services/manifest.js';
import { createCommentsRepository } from '../../../MoarTube-Node/src/database/repositories/comments/index.js';
import { createVideosRepository } from '../../../MoarTube-Node/src/database/repositories/videos/index.js';
import { CommentsService } from '../../../MoarTube-Node/src/services/comments.js';
import { videosRoutes } from '../../../MoarTube-Node/src/routes/videos.js';
import { Logger } from '../../../MoarTube-Node/src/utils/logger.js';
import {
  openTestDatabase,
  comment,
  video,
} from '../../../MoarTube-Node/tests/integration/sqlite/helpers.js';

vi.mock('../../../MoarTube-Node/src/config/index.js', () => ({
  getConfig: () => ({
    nodeSettings: { isCommentsEnabled: true, isCloudflareTurnstileEnabled: false },
    getExternalVideosBaseUrl: () => 'https://media.example',
  }),
}));
const id = 'clientAud01';
let app: FastifyInstance;
let database: ReturnType<typeof openTestDatabase>;
let comments: ReturnType<typeof createCommentsRepository>;
let api: NodeApiService;
let commentId: number;
const purge = vi.fn().mockResolvedValue(undefined);
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const reply = () => ({ status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() });
beforeEach(async () => {
  vi.clearAllMocks();
  database = openTestDatabase();
  comments = createCommentsRepository('sqlite', database.db);
  await createVideosRepository('sqlite', database.db).create(video(id));
  commentId = (await comments.create(comment(id, 100))).comment_id;
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('optionalAuthenticate', async () => {});
  app.decorate('authenticate', async (request: { headers: { authorization?: string } }) => {
    if (request.headers.authorization !== 'Bearer audit-token') {
      throw new Error('Missing test authentication');
    }
  });
  const services = {
    commentsService: new CommentsService(Logger.getInstance(), comments),
    videosService: { getVideo: async () => ({ is_comments_enabled: true }) },
    videoUploadService: {},
    reportsService: {},
    cloudflareService: { purgeWatchPages: purge, purgePrefixes: purge },
  };
  await app.register(
    async (scoped) => {
      videosRoutes(scoped, { resolve: (name: keyof typeof services) => services[name] } as never);
    },
    { prefix: '/videos' }
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as { port: number };
  api = new NodeApiService(
    logger as never,
    {
      clientSettings: { nodeHttpProtocol: 'http', nodeIp: '127.0.0.1', nodePort: address.port },
    } as never
  );
});
afterEach(async () => {
  api?.close();
  await app?.close();
  database?.close();
});

describe('Client-to-Node mutation contracts after remediation', () => {
  it.each(['../settings.json', 'https://other.example/image.jpg', 'images/preview.jpg?query=1'])(
    'rejects a Client invalidation path outside public media: %s',
    async (relative) => {
      const response = await app.inject({
        method: 'POST',
        url: '/videos/' + id + '/cache/invalidate',
        headers: { authorization: 'Bearer audit-token' },
        payload: { paths: [relative] },
      });
      expect(response.statusCode).toBe(400);
      expect(purge).not.toHaveBeenCalled();
    }
  );

  it('dispatches an authenticated scoped Client media invalidation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/videos/' + id + '/cache/invalidate',
      headers: { authorization: 'Bearer audit-token' },
      payload: { paths: ['images/preview.jpg', 'adaptive/m3u8/'] },
    });
    expect(response.statusCode).toBe(200);
    expect(purge).toHaveBeenCalledWith(
      [
        'https://media.example/external/videos/' + id + '/images/preview.jpg',
        'https://media.example/external/videos/' + id + '/adaptive/m3u8/',
      ],
      true
    );
  });
  it('administrative comment deletion crosses actual Client controller/API and Node route, commits deletion, advances revision and requests purge', async () => {
    const version = await comments.getCacheVersion(id);
    const output = reply();
    await new ClientComments(api).postDelete(
      {
        session: { jwtToken: 'audit-token' },
        body: { videoId: id, commentId, timestamp: 100 },
      } as never,
      output as never
    );
    expect(output.send).toHaveBeenCalledWith({ isError: false, commentId });
    expect(await comments.findById(id, commentId, 100)).toBeNull();
    expect(await comments.getCacheVersion(id)).toBeGreaterThan(version);
    expect(purge).toHaveBeenCalledWith([id]);
  });

  it('a rejected comment deletion stays rejected through Client and does not request purge', async () => {
    const output = reply();
    await new ClientComments(api).postDelete(
      {
        session: { jwtToken: 'audit-token' },
        body: { videoId: id, commentId, timestamp: 999 },
      } as never,
      output as never
    );
    expect(output.send.mock.calls[0]?.[0]).toMatchObject({ isError: true });
    expect(await comments.findById(id, commentId, 100)).not.toBeNull();
    expect(purge).not.toHaveBeenCalled();
  });

  it('S3 preview replacement invalidates the primed edge only after committing origin bytes', async () => {
    let origin = Buffer.from('old image');
    let edge = origin;
    const invalidate = vi.fn();
    const client = new ClientVideos(
      {
        getNodeSettings: async () => ({
          storageConfig: { storageMode: 's3provider', s3Config: {} },
        }),
        withVideoCacheInvalidation: async (
          _token: string,
          _video: string,
          paths: string[],
          write: () => Promise<unknown>
        ) => {
          await write();
          invalidate(paths);
          edge = origin;
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        putObjectFromData: async (_config: unknown, _key: string, bytes: Buffer) => {
          origin = bytes;
        },
      } as never,
      {} as never,
      {} as never
    );
    const output = reply();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64'
    );
    await client.postPreview(
      {
        session: { jwtToken: 'audit-token' },
        params: { videoId: id },
        file: async () => ({ toBuffer: async () => png }),
      } as never,
      output as never
    );
    expect(output.send).toHaveBeenCalledWith({ isError: false });
    expect(origin.equals(edge)).toBe(true);
    expect(invalidate).toHaveBeenCalledWith(['images/preview.jpg']);
  });

  it('filesystem preview UI preserves Node semantic rejection', async () => {
    const client = new ClientVideos(
      {
        getNodeSettings: async () => ({ storageConfig: { storageMode: 'filesystem' } }),
        setPreview: async () => ({ isError: true, message: 'origin rejected write' }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const output = reply();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64'
    );
    await client.postPreview(
      {
        session: { jwtToken: 'audit-token' },
        params: { videoId: id },
        file: async () => ({ toBuffer: async () => png }),
      } as never,
      output as never
    );
    expect(output.send.mock.calls[0]?.[0]).toMatchObject({ isError: true });
  });

  it('S3 master refresh delegates the write and invalidation to Node', async () => {
    const events: string[] = [];
    const manifests = new ClientManifests(
      logger as never,
      {
        getVideoData: async () => ({
          isError: false,
          videoData: { isStreaming: false, outputs: { m3u8: ['720p'] } },
        }),
        getExternalVideosBaseUrl: async () => 'https://media.example',
        getNodeSettings: async () => ({
          storageConfig: { storageMode: 's3provider', s3Config: {} },
        }),
        uploadM3u8MasterManifest: async () => {
          events.push('node-master-write');
          return { isError: false };
        },
      } as never,
      {
        putObjectFromData: async () => {
          events.push('write');
        },
      } as never
    );
    await manifests.refreshMasterManifest('audit-token', id);
    expect(events).toEqual(['node-master-write']);
  });
});
