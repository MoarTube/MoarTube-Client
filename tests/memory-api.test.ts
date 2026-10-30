import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { SettingsController } from '../src/controllers/settings.js';
import { getMemoryMetrics, type MemoryMetrics } from '../src/utils/memory-metrics.js';

vi.mock('../src/utils/memory-metrics.js', () => ({ getMemoryMetrics: vi.fn() }));

it('authenticates RAM requests, accounts for the desktop root, and proxies node RAM without using S3 configuration', async () => {
  const metrics: MemoryMetrics = { appBytes: 100, availableBytes: 200, totalBytes: 1000 };
  vi.mocked(getMemoryMetrics).mockResolvedValue(metrics);
  const remote = vi.fn().mockResolvedValue({ ...metrics, appBytes: 150 });
  const auth = vi.fn().mockResolvedValue({ isError: false, isAuthenticated: true });
  const controller = new SettingsController(
    {} as never,
    { isAuthenticated: auth, getMemoryMetrics: remote } as never,
    {} as never,
    {} as never
  );
  let jwtToken: string | undefined;
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken } as typeof request.session;
    done();
  });
  app.get('/settings/metrics/:target/memory', controller.apiGetMemoryMetrics);
  vi.stubEnv('MOARTUBE_METRICS_ROOT_PID', '1234');
  try {
    expect((await app.inject('/settings/metrics/client/memory')).statusCode).toBe(401);
    expect(getMemoryMetrics).not.toHaveBeenCalled();
    jwtToken = 'test-token';
    const client = await app.inject('/settings/metrics/client/memory');
    expect(client.json<{ metrics: MemoryMetrics }>().metrics).toEqual(metrics);
    expect(client.headers['cache-control']).toBe('no-store');
    expect(getMemoryMetrics).toHaveBeenCalledWith(1234);
    vi.stubEnv('MOARTUBE_METRICS_ROOT_PID', 'invalid');
    await app.inject('/settings/metrics/client/memory');
    expect(getMemoryMetrics).toHaveBeenLastCalledWith(process.pid);
    const node = await app.inject('/settings/metrics/node/memory');
    expect(node.json<{ metrics: MemoryMetrics }>().metrics.appBytes).toBe(150);
    expect(remote).toHaveBeenCalledWith('test-token');
    remote.mockRejectedValueOnce(new Error('Node is offline'));
    expect((await app.inject('/settings/metrics/node/memory')).statusCode).toBe(500);
    expect((await app.inject('/settings/metrics/unknown/memory')).statusCode).toBe(404);
    auth.mockResolvedValueOnce({ isError: false, isAuthenticated: false });
    expect((await app.inject('/settings/metrics/node/memory')).statusCode).toBe(401);
  } finally {
    vi.unstubAllEnvs();
    await app.close();
  }
});
