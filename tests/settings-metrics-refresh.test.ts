import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

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
    const metrics = vm.runInContext(source + '\nnew MoarTubeStorageMetrics()', context);
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
