import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { SettingsController } from '../src/controllers/settings.js';
import { NodeApiService } from '../src/services/node-api.js';
import { settingsRoutes } from '../src/routes/settings.js';

it('validates S3 read/write access without deletion and forwards all migration directions to the Node', async () => {
  const node = Fastify();
  const received: unknown[] = [];
  node.post('/settings/storage/migrate', (request) => {
    expect(request.headers.authorization).toBe('Bearer token');
    received.push(request.body);
    return { isError: false, filesCopied: 3 };
  });
  await node.listen({ host: '127.0.0.1', port: 0 });
  const config = {
    clientSettings: {
      nodeIp: '127.0.0.1',
      nodePort: (node.server.address() as { port: number }).port,
      nodeHttpProtocol: 'http',
    },
  };
  const api = new NodeApiService(
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    config as never
  );
  const validateS3Config = vi.fn().mockResolvedValue(undefined);
  const client = Fastify();
  let token = 'token';
  client.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: token } as never;
    done();
  });
  const dependencies = {
    config,
    nodeApiService: api,
    s3Service: { validateS3Config },
    ffmpegService: {},
  };
  settingsRoutes(client, {
    resolve: (key: keyof typeof dependencies) => dependencies[key],
  } as never);
  const source = {
    bucketName: 'source',
    s3ProviderClientConfig: {
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
    },
  };
  const destination = { ...source, bucketName: 'destination' };
  const payloads = [
    { direction: 'filesystem-to-s3', destination },
    { direction: 's3-to-s3', source, destination },
    { direction: 's3-to-filesystem', source },
  ];
  try {
    for (const payload of payloads) {
      const response = await client.inject({
        method: 'POST',
        url: '/node/storage/migrate',
        payload,
      });
      expect(response.json()).toEqual({ isError: false, filesCopied: 3 });
    }
    expect(received).toEqual(payloads);
    expect(validateS3Config.mock.calls).toEqual([
      [destination, false],
      [source, false],
      [destination, false],
      [source, false],
    ]);
    for (const payload of [
      {},
      { direction: 's3-to-s3', source },
      { direction: 'filesystem-to-s3', destination: {} },
    ]) {
      expect(
        (await client.inject({ method: 'POST', url: '/node/storage/migrate', payload })).statusCode
      ).toBe(400);
    }
    validateS3Config.mockRejectedValue(new Error('secret credentials'));
    const failed = await client.inject({
      method: 'POST',
      url: '/node/storage/migrate',
      payload: payloads[0],
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.body).toContain('partially overwritten');
    expect(failed.body).not.toContain('secret credentials');
    expect(received).toHaveLength(3);
    token = '';
    expect(
      (await client.inject({ method: 'POST', url: '/node/storage/migrate', payload: payloads[0] }))
        .statusCode
    ).toBe(401);
  } finally {
    api.close();
    await client.close();
    await node.close();
  }
});

it('reports Node migration failures without claiming completion', async () => {
  const controller = new SettingsController(
    {} as never,
    { migrateStorage: vi.fn().mockRejectedValue(new Error('offline')) } as never,
    { validateS3Config: vi.fn() } as never,
    {} as never
  );
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: 'token' } as never;
    done();
  });
  app.post('/migrate', controller.apiMigrateStorage);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/migrate',
      payload: {
        direction: 's3-to-filesystem',
        source: {
          bucketName: 'bucket',
          s3ProviderClientConfig: { credentials: { accessKeyId: 'a', secretAccessKey: 'b' } },
        },
      },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json<{ isError: boolean }>().isError).toBe(true);
  } finally {
    await app.close();
  }
});
