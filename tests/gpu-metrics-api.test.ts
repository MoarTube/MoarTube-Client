import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { SettingsController } from '../src/controllers/settings.js';
import { getGpuMetrics, type GpuMetrics } from '../src/utils/gpu-metrics.js';
import type { ClientSettings } from '../src/config/index.js';

vi.mock('../src/utils/gpu-metrics.js', () => ({ getGpuMetrics: vi.fn() }));

it('authenticates GPU metrics and uses the latest saved GPU acceleration setting', async () => {
  const metrics: GpuMetrics = {
    encodePercent: 45,
    decodePercent: 5,
    memoryUsedBytes: 1024,
    memoryTotalBytes: 8192,
    appEncodePercent: 30,
    appDecodePercent: 2,
    appMemoryBytes: 512,
  };
  vi.mocked(getGpuMetrics).mockResolvedValue(metrics);
  const config = {
    clientSettings: { processingAgent: { processingAgentType: 'gpu', deviceUuid: 'GPU-selected' } },
  } as { clientSettings: Pick<ClientSettings, 'processingAgent'> };
  const auth = vi.fn().mockResolvedValue({ isError: false, isAuthenticated: true });
  const controller = new SettingsController(
    config as never,
    { isAuthenticated: auth } as never,
    {} as never,
    {} as never
  );
  let jwtToken: string | undefined;
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken } as typeof request.session;
    done();
  });
  app.get('/settings/metrics/client/gpu', controller.apiGetGpuMetrics);
  vi.stubEnv('MOARTUBE_METRICS_ROOT_PID', '1234');
  try {
    expect((await app.inject('/settings/metrics/client/gpu')).statusCode).toBe(401);
    expect(getGpuMetrics).not.toHaveBeenCalled();
    jwtToken = 'test-token';
    const response = await app.inject('/settings/metrics/client/gpu');
    expect(response.json<{ metrics: GpuMetrics }>().metrics).toEqual(metrics);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(getGpuMetrics).toHaveBeenLastCalledWith(config.clientSettings.processingAgent, 1234);
    vi.stubEnv('MOARTUBE_METRICS_ROOT_PID', 'invalid');
    config.clientSettings.processingAgent = { processingAgentType: 'cpu' };
    const zero = {
      encodePercent: 0,
      decodePercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      appEncodePercent: 0,
      appDecodePercent: 0,
      appMemoryBytes: 0,
    };
    vi.mocked(getGpuMetrics).mockResolvedValueOnce(zero);
    const disabled = await app.inject('/settings/metrics/client/gpu');
    expect(disabled.json<{ metrics: GpuMetrics }>().metrics).toEqual(zero);
    expect(getGpuMetrics).toHaveBeenLastCalledWith({ processingAgentType: 'cpu' }, process.pid);
    auth.mockResolvedValueOnce({ isError: false, isAuthenticated: false });
    expect((await app.inject('/settings/metrics/client/gpu')).statusCode).toBe(401);
    vi.mocked(getGpuMetrics).mockRejectedValueOnce(new Error('Monitoring unavailable'));
    expect((await app.inject('/settings/metrics/client/gpu')).statusCode).toBe(500);
  } finally {
    vi.unstubAllEnvs();
    await app.close();
  }
});
