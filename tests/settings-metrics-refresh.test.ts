import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

it('makes one bundle request per refresh, prevents overlap, and recovers after a failed request', async () => {
  const source = await readFile('public/javascript/settings-metrics.js', 'utf8');
  let done = (_data: unknown) => {};
  let fail = (_xhr: unknown, _status: string) => {};
  let always = () => {};
  const request = {
    done: (handler: typeof done) => { done = handler; return request; },
    fail: (handler: typeof fail) => { fail = handler; return request; },
    always: (handler: typeof always) => { always = handler; return request; },
  };
  const ajax = vi.fn().mockReturnValue(request);
  const $ = Object.assign(() => ({ on: vi.fn(), attr: vi.fn() }), { ajax });
  const context = vm.createContext({ $, window: { addEventListener: vi.fn() } });
  const metrics = vm.runInContext(source + '\nnew MoarTubeStorageMetrics()', context) as {
    refresh: ReturnType<typeof vi.fn>;
    start: () => void;
    requests: Set<unknown>;
    renderGpu: ReturnType<typeof vi.fn>;
    renderUsage: ReturnType<typeof vi.fn>;
    renderMemory: ReturnType<typeof vi.fn>;
    renderDisk: ReturnType<typeof vi.fn>;
  };
  metrics.renderGpu = vi.fn();
  metrics.renderUsage = vi.fn();
  metrics.renderMemory = vi.fn();
  metrics.renderDisk = vi.fn();
  metrics.refresh();
  metrics.refresh();
  expect(ajax).toHaveBeenCalledExactlyOnceWith({ url: '/settings/metrics', dataType: 'json', timeout: 120000 });
  const cpu = { metrics: { usedPercent: 25, appPercent: 5 } };
  done({ isError: false, metrics: { client: { cpu } } });
  expect(metrics.renderUsage).toHaveBeenCalledWith('client', 'cpu', cpu);
  expect(metrics.renderDisk).toHaveBeenCalledWith('node', { isError: true });
  always();
  metrics.refresh();
  expect(ajax).toHaveBeenCalledTimes(2);
  fail(null, 'timeout');
  expect(metrics.renderGpu).toHaveBeenLastCalledWith({ isError: true });
  always();
  metrics.renderGpu.mockClear();
  metrics.refresh();
  fail(null, 'abort');
  expect(metrics.renderGpu).not.toHaveBeenCalled();
  always();
  expect(metrics.requests.size).toBe(0);
});

it('changes the metrics interval without duplicate timers and stops polling when leaving the page', async () => {
  const source = await readFile('public/javascript/settings-metrics.js', 'utf8');
  const events: Record<string, (event: { persisted?: boolean }) => void> = {};
  let change: (event: { target: { value: string } }) => void = () => {};
  vi.useFakeTimers();
  try {
    const context = vm.createContext({
      setInterval,
      clearInterval,
      window: {
        addEventListener: (name: string, handler: (event: { persisted?: boolean }) => void) => {
          events[name] = handler;
        },
      },
      $: () => ({
        on: (_name: string, handler: typeof change) => { change = handler; },
      }),
    });
    const metrics = vm.runInContext(source + '\nnew MoarTubeStorageMetrics()', context) as {
    refresh: ReturnType<typeof vi.fn>;
    start: () => void;
    requests: Set<unknown>;
    renderGpu: ReturnType<typeof vi.fn>;
    renderUsage: ReturnType<typeof vi.fn>;
    renderMemory: ReturnType<typeof vi.fn>;
    renderDisk: ReturnType<typeof vi.fn>;
  };
    metrics.refresh = vi.fn();
    metrics.start();
    expect(metrics.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1999);
    expect(metrics.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(metrics.refresh).toHaveBeenCalledTimes(2);

    for (let seconds = 1; seconds <= 10; seconds++) {
      change({ target: { value: String(seconds) } });
      expect(vi.getTimerCount()).toBe(1);
      metrics.refresh.mockClear();
      vi.advanceTimersByTime(seconds * 1000 - 1);
      expect(metrics.refresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(metrics.refresh).toHaveBeenCalledTimes(1);
    }

    const abort = vi.fn();
    metrics.requests.add({ abort });
    events.pagehide({});
    expect(abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    metrics.refresh.mockClear();
    vi.advanceTimersByTime(10000);
    expect(metrics.refresh).not.toHaveBeenCalled();
    events.pageshow({ persisted: true });
    expect(metrics.refresh).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    metrics.start();
    expect(vi.getTimerCount()).toBe(1);
    events.beforeunload({});
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
