import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { NodeApiService } from '../src/services/node-api.js';
import { settingsRoutes } from '../src/routes/settings.js';
import { SettingsController } from '../src/controllers/settings.js';
import { getCpuMetrics } from '../src/utils/cpu-metrics.js';
import { getMemoryMetrics } from '../src/utils/memory-metrics.js';
import { getGpuMetrics } from '../src/utils/gpu-metrics.js';
import { getStorageMetrics } from '../src/utils/storage-metrics.js';

vi.mock('../src/utils/cpu-metrics.js', () => ({ getCpuMetrics: vi.fn() }));
vi.mock('../src/utils/memory-metrics.js', () => ({ getMemoryMetrics: vi.fn() }));
vi.mock('../src/utils/gpu-metrics.js', () => ({ getGpuMetrics: vi.fn() }));
vi.mock('../src/utils/storage-metrics.js', () => ({ getStorageMetrics: vi.fn() }));

it('uses one authenticated Node bundle, collects concurrently, and preserves independent results', async () => {
  const cpu = { usedPercent: 25, appPercent: 5 };
  const memory = { appBytes: 10, availableBytes: 20, totalBytes: 100 };
  const disk = {
    storageMode: 'filesystem' as const,
    mediaBytes: 10,
    availableBytes: 20,
    totalBytes: 100,
  };
  const gpu = {
    encodePercent: 0,
    decodePercent: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    appEncodePercent: 0,
    appDecodePercent: 0,
    appMemoryBytes: 0,
  };
  let releaseCpu = (): void => {};
  vi.mocked(getCpuMetrics).mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseCpu = (): void => {
          resolve(cpu);
        };
      })
  );
  vi.mocked(getMemoryMetrics).mockResolvedValue(memory);
  vi.mocked(getGpuMetrics).mockResolvedValue(gpu);
  vi.mocked(getStorageMetrics).mockResolvedValue(disk);
  const success = (metrics: unknown): { isError: false; metrics: unknown } => ({
    isError: false,
    metrics,
  });
  const bundle = { cpu: success(cpu), memory: success(memory), disk: success(disk) };
  const node = {
    getMetricsBundle: vi
      .fn()
      .mockResolvedValue({ status: 200, data: { isError: false, metrics: bundle } }),
    isAuthenticated: vi.fn().mockResolvedValue({ isError: false, isAuthenticated: true }),
    getCpuMetrics: vi.fn().mockResolvedValue(cpu),
    getMemoryMetrics: vi.fn().mockResolvedValue(memory),
    getNodeSettings: vi.fn().mockResolvedValue({ storageConfig: { storageMode: 'filesystem' } }),
    getStorageMetrics: vi.fn().mockResolvedValue(disk),
  };
  const agent = { processingAgentType: 'cpu' };
  const controller = new SettingsController(
    { paths: { data: 'data' }, clientSettings: { processingAgent: agent } } as never,
    node as never,
    {} as never,
    {} as never
  );
  let jwtToken: string | undefined;
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken } as typeof request.session;
    done();
  });
  app.get('/settings/metrics', controller.apiGetMetricsBundle);
  vi.stubEnv('MOARTUBE_METRICS_ROOT_PID', '1234');
  try {
    expect((await app.inject('/settings/metrics')).statusCode).toBe(401);
    expect(node.isAuthenticated).not.toHaveBeenCalled();
    jwtToken = 'test-token';
    vi.mocked(getCpuMetrics).mockResolvedValueOnce(cpu);
    node.getMetricsBundle.mockResolvedValueOnce({ status: 401, data: { isError: true } });
    expect((await app.inject('/settings/metrics')).statusCode).toBe(401);
    node.getMetricsBundle.mockClear();
    const pending = app.inject('/settings/metrics');
    // Start the request while holding one collector open. All others must still run.
    const responsePromise = pending.then((response) => response);
    await vi.waitFor(() => {
      expect(node.getMetricsBundle).toHaveBeenCalledExactlyOnceWith('test-token');
    });
    expect(getMemoryMetrics).toHaveBeenCalledWith(1234);
    expect(getGpuMetrics).toHaveBeenCalledWith(agent, 1234);
    expect(node.getCpuMetrics).not.toHaveBeenCalled();
    expect(node.getMemoryMetrics).not.toHaveBeenCalled();
    expect(node.getStorageMetrics).not.toHaveBeenCalled();
    expect(node.getNodeSettings).not.toHaveBeenCalled();
    releaseCpu();
    const response = await responsePromise;
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(node.isAuthenticated).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      isError: false,
      metrics: {
        client: {
          cpu: success(cpu),
          memory: success(memory),
          disk: success(disk),
          gpu: success(gpu),
        },
        node: { cpu: success(cpu), memory: success(memory), disk: success(disk) },
      },
    });

    vi.mocked(getCpuMetrics).mockResolvedValue(cpu);
    vi.mocked(getGpuMetrics).mockRejectedValueOnce(new Error('GPU unavailable'));
    node.getMetricsBundle.mockResolvedValueOnce({
      status: 200,
      data: {
        isError: false,
        metrics: {
          cpu: success(cpu),
          memory: { isError: true },
          disk: success({
            storageMode: 's3provider',
            mediaBytes: null,
            availableBytes: null,
            totalBytes: null,
          }),
        },
      },
    });
    const partial = (await app.inject('/settings/metrics')).json<{
      isError: boolean;
      metrics: { client: { gpu: unknown; cpu: unknown }; node: { memory: unknown; disk: unknown } };
    }>();
    expect(partial.isError).toBe(false);
    expect(partial.metrics.client.gpu).toEqual({ isError: true });
    expect(partial.metrics.node.memory).toEqual({ isError: true });
    expect(partial.metrics.client.cpu).toEqual(success(cpu));
    expect(partial.metrics.node.disk).toEqual(
      success({
        storageMode: 's3provider',
        mediaBytes: null,
        availableBytes: null,
        totalBytes: null,
      })
    );
    expect(node.getMetricsBundle).toHaveBeenCalledTimes(2);
    node.getMetricsBundle.mockRejectedValueOnce(new Error('Node unavailable'));
    const unavailable = (await app.inject('/settings/metrics')).json<{
      metrics: { node: unknown; client: { cpu: unknown } };
    }>();
    expect(unavailable.metrics.node).toEqual({
      cpu: { isError: true },
      memory: { isError: true },
      disk: { isError: true },
    });
    expect(unavailable.metrics.client.cpu).toEqual(success(cpu));
  } finally {
    vi.unstubAllEnvs();
    await app.close();
  }
});

it('makes exactly one HTTP request to the Node per refresh, including authentication failures', async () => {
  const cpu = { usedPercent: 25, appPercent: 5 };
  const memory = { appBytes: 10, availableBytes: 20, totalBytes: 100 };
  const disk = {
    storageMode: 'filesystem' as const,
    mediaBytes: 10,
    availableBytes: 20,
    totalBytes: 100,
  };
  vi.mocked(getCpuMetrics).mockResolvedValue(cpu);
  vi.mocked(getMemoryMetrics).mockResolvedValue(memory);
  vi.mocked(getStorageMetrics).mockResolvedValue(disk);
  const bundle = {
    cpu: { isError: false, metrics: cpu },
    memory: { isError: true },
    disk: { isError: false, metrics: disk },
  };
  const requests: string[] = [];
  let status = 200;
  const node = Fastify();
  node.addHook('onRequest', (request, _reply, done) => {
    requests.push(request.url);
    expect(request.headers.authorization).toBe('Bearer token');
    done();
  });
  node.get('/settings/metrics', (_request, reply) =>
    reply
      .status(status)
      .send(status === 200 ? { isError: false, metrics: bundle } : { isError: true })
  );
  await node.listen({ host: '127.0.0.1', port: 0 });
  const address = node.server.address() as { port: number };
  const config = {
    paths: { data: 'data' },
    clientSettings: {
      nodeIp: '127.0.0.1',
      nodePort: address.port,
      nodeHttpProtocol: 'http',
      processingAgent: { processingAgentType: 'cpu' },
    },
  };
  const api = new NodeApiService(
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    config as never
  );
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken: 'token' } as typeof request.session;
    done();
  });
  const dependencies = { config, nodeApiService: api, s3Service: {}, ffmpegService: {} };
  await app.register(
    (instance, _options, done) => {
      settingsRoutes(instance, {
        resolve: (key: keyof typeof dependencies) => dependencies[key],
      } as never);
      done();
    },
    { prefix: '/settings' }
  );
  try {
    const response = await app.inject('/settings/metrics');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ metrics: { node: unknown } }>().metrics.node).toEqual(bundle);
    for (status of [401, 403]) {
      expect((await app.inject('/settings/metrics')).statusCode).toBe(status);
    }
    status = 503;
    const unavailable = await app.inject('/settings/metrics');
    expect(unavailable.json<{ metrics: { node: unknown } }>().metrics.node).toEqual({
      cpu: { isError: true },
      memory: { isError: true },
      disk: { isError: true },
    });
    expect(requests).toEqual(Array(4).fill('/settings/metrics'));
  } finally {
    api.close();
    await app.close();
    await node.close();
  }
});
