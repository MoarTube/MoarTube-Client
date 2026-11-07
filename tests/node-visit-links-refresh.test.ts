import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

interface VisitLinks {
  start: (settings: object, tunnel?: object | null) => void;
  stop: () => void;
  render: ReturnType<typeof vi.fn>;
  initialSettings: object;
}

it('checks only tunnel status, follows startup without an attempt limit, retries request failures, and stops at settled states', async () => {
  const source = await readFile('public/javascript/node-visit-links.js', 'utf8');
  const settings = { isCloudflareTunnelEnabled: true, isCloudflareCdnEnabled: false };
  const starting = { status: 'starting' };
  const running = { status: 'running', mode: 'quick', publicUrl: 'https://quick.test' };
  const ajax = vi.fn().mockResolvedValue({ tunnel: starting });
  const windowEvents = vi.fn();
  vi.useFakeTimers();
  try {
    const context = vm.createContext({
      window: { setTimeout, clearTimeout, addEventListener: windowEvents },
      $: { ajax },
    });
    // Exercise the polling lifecycle without coupling it to sidebar markup.
    const links = vm.runInContext(source + `
      Object.assign(Object.create(MoarTubeNodeVisitLinks.prototype), {
        requests: [], generation: 0
      })`, context) as VisitLinks;
    links.render = vi.fn();
    links.start(settings);
    await vi.advanceTimersByTimeAsync(0);
    expect(ajax).toHaveBeenCalledExactlyOnceWith({
      type: 'GET', url: '/settings/node/cloudflare/tunnel', cache: false, timeout: 10000,
    });
    ajax.mockResolvedValueOnce({ tunnel: running });
    await vi.advanceTimersByTimeAsync(2000);
    expect(links.render).toHaveBeenLastCalledWith(settings, running);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(ajax).toHaveBeenCalledTimes(2);

    // Reuse status returned by a settings action without another request.
    links.start(settings, running);
    expect(ajax).toHaveBeenCalledTimes(2);
    links.start(settings, starting);
    ajax.mockRejectedValueOnce(new Error('Unavailable'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(links.render).toHaveBeenLastCalledWith(settings, null);
    expect(vi.getTimerCount()).toBe(1);
    ajax.mockResolvedValueOnce({ isError: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(1);
    ajax.mockResolvedValueOnce({ tunnel: running });
    await vi.advanceTimersByTimeAsync(2000);
    expect(links.render).toHaveBeenLastCalledWith(settings, running);
    expect(vi.getTimerCount()).toBe(0);

    // A failed initial status supplied by a settings action also gets retried.
    links.start(settings, null);
    expect(vi.getTimerCount()).toBe(1);
    links.stop();
    expect(vi.getTimerCount()).toBe(0);

    for (const status of ['stopped', 'error']) {
      links.start(settings, { status });
      expect(vi.getTimerCount()).toBe(0);
    }
    const calls = ajax.mock.calls.length;
    links.start({ ...settings, isCloudflareTunnelEnabled: false });
    links.start({ ...settings, isCloudflareCdnEnabled: true });
    expect(ajax).toHaveBeenCalledTimes(calls);

    // Continue checking beyond the former attempt limit while startup is in progress.
    links.start(settings, starting);
    await vi.advanceTimersByTimeAsync(120000);
    expect(ajax).toHaveBeenCalledTimes(calls + 60);
    expect(vi.getTimerCount()).toBe(1);
    ajax.mockResolvedValueOnce({ tunnel: running });
    await vi.advanceTimersByTimeAsync(2000);
    expect(links.render).toHaveBeenLastCalledWith(settings, running);
    expect(vi.getTimerCount()).toBe(0);
    links.start(settings, starting);
    links.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(windowEvents).not.toHaveBeenCalledWith('focus', expect.anything());
  } finally {
    vi.useRealTimers();
  }
});
