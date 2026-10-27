import { describe, expect, it, vi } from 'vitest';
import { WorkPool } from '../src/utils/work-pool.js';
import { ExpiringSessionStore } from '../src/utils/session-store.js';

describe('bounded resource scheduling', () => {
  it('limits concurrent work and releases slots after failures', async () => {
    const pool = new WorkPool(1, 1);
    const release = await pool.acquire();
    let started = false;
    const queued = pool.run(() => {
      started = true;
      return Promise.reject(new Error('work failed'));
    });
    await expect(pool.acquire()).rejects.toThrow('queue');
    expect(started).toBe(false);
    release();
    await expect(queued).rejects.toThrow('work failed');
    (await pool.acquire())();
  });
});
describe('session retention', () => {
  it('expires abandoned sessions without needing to access them', () => {
    vi.useFakeTimers();
    const store = new ExpiringSessionStore(100, 2);
    const done = vi.fn();
    store.set('a', {} as never, done);
    expect(store.size).toBe(1);
    vi.advanceTimersByTime(200);
    expect(store.size).toBe(0);
    store.close();
    vi.useRealTimers();
  });
  it('caps retained sessions and supports explicit destruction', () => {
    const store = new ExpiringSessionStore(1000, 1);
    const done = vi.fn();
    store.set('a', {} as never, done);
    store.set('b', {} as never, done);
    expect(store.size).toBe(1);
    store.get('a', (error, value) => {
      expect(error).toBeNull();
      expect(value).toBeNull();
    });
    store.destroy('b', done);
    expect(store.size).toBe(0);
    store.close();
  });
});
