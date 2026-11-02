import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { SettingsController } from '../src/controllers/settings.js';
import { getCpuMetrics } from '../src/utils/cpu-metrics.js';

vi.mock('../src/utils/cpu-metrics.js', () => ({ getCpuMetrics: vi.fn() }));

it('authenticates CPU requests and gets utilization from the correct system', async () => {
  vi.mocked(getCpuMetrics).mockResolvedValue({ usedPercent: 25, appPercent: 10 });
  const remote = vi.fn().mockResolvedValue({ usedPercent: 75, appPercent: 30 });
  const auth = vi.fn().mockResolvedValue({ isError: false, isAuthenticated: true });
  const controller = new SettingsController(
    {} as never,
    { isAuthenticated: auth, getCpuMetrics: remote } as never,
    {} as never,
    {} as never
  );
  let jwtToken: string | undefined;
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.session = { jwtToken } as typeof request.session;
    done();
  });
  app.get('/settings/metrics/:target/cpu', controller.apiGetCpuMetrics);
  vi.stubEnv('MOARTUBE_METRICS_ROOT_PID', '1234');
  try {
    expect((await app.inject('/settings/metrics/client/cpu')).statusCode).toBe(401);
    expect(getCpuMetrics).not.toHaveBeenCalled();
    jwtToken = 'test-token';
    const client = await app.inject('/settings/metrics/client/cpu');
    expect(client.json<{ metrics: { usedPercent: number; appPercent: number } }>().metrics).toEqual(
      { usedPercent: 25, appPercent: 10 }
    );
    expect(getCpuMetrics).toHaveBeenLastCalledWith(1234);
    vi.stubEnv('MOARTUBE_METRICS_ROOT_PID', 'invalid');
    await app.inject('/settings/metrics/client/cpu');
    expect(getCpuMetrics).toHaveBeenLastCalledWith(process.pid);
    expect(client.headers['cache-control']).toBe('no-store');
    const node = await app.inject('/settings/metrics/node/cpu');
    expect(node.json<{ metrics: { usedPercent: number; appPercent: number } }>().metrics).toEqual({
      usedPercent: 75,
      appPercent: 30,
    });
    expect(remote).toHaveBeenCalledWith('test-token');
    remote.mockRejectedValueOnce(new Error('Node is offline'));
    expect((await app.inject('/settings/metrics/node/cpu')).statusCode).toBe(500);
    expect((await app.inject('/settings/metrics/unknown/cpu')).statusCode).toBe(404);
    auth.mockResolvedValueOnce({ isError: false, isAuthenticated: false });
    expect((await app.inject('/settings/metrics/node/cpu')).statusCode).toBe(401);
  } finally {
    vi.unstubAllEnvs();
    await app.close();
  }
});
