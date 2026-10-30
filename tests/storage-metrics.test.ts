import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {
  getDirectorySize,
  getStorageMetrics,
  type StorageMetrics,
} from '../src/utils/storage-metrics.js';
import { SettingsController } from '../src/controllers/settings.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'moartube-metrics-'));
});
afterEach(async () => {
  expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
  expect(path.basename(directory)).toMatch(/^moartube-metrics-/);
  await rm(directory, { recursive: true, force: true });
});

describe('storage metrics', () => {
  it('counts all nested media files and reflects finalization', async () => {
    const video = path.join(directory, 'videos', 'video-1');
    await mkdir(video, { recursive: true });
    await writeFile(path.join(directory, 'other-media'), Buffer.alloc(7));
    await writeFile(path.join(video, 'source.mp4'), Buffer.alloc(1024));
    await writeFile(path.join(video, 'encoded.mp4'), Buffer.alloc(2048));
    expect(await getDirectorySize(directory)).toBe(3079);
    await rm(video, { recursive: true });
    expect(await getDirectorySize(directory)).toBe(7);
  });

  it('reports zero usage and the containing disk capacity before media exists', async () => {
    const metrics = await getStorageMetrics(path.join(directory, 'media'));
    expect(metrics.mediaBytes).toBe(0);
    expect(metrics.storageMode).toBe('filesystem');
    expect(metrics.totalBytes).toBeGreaterThan(0);
    expect(metrics.availableBytes).toBeGreaterThanOrEqual(0);
    expect(metrics.availableBytes).toBeLessThanOrEqual(metrics.totalBytes ?? 0);
  });

  it('ignores links outside the media folder and directory cycles', async () => {
    const media = path.join(directory, 'media');
    const outside = path.join(directory, 'outside');
    await mkdir(media);
    await mkdir(outside);
    await writeFile(path.join(outside, 'excluded.mp4'), Buffer.alloc(100));
    await writeFile(path.join(media, 'included.mp4'), Buffer.alloc(10));
    await symlink(outside, path.join(media, 'external'), 'junction');
    await symlink(media, path.join(media, 'cycle'), 'junction');
    expect(await getDirectorySize(media)).toBe(10);
  });

  it('authenticates, separates client and node usage, and handles S3 without scanning it', async () => {
    let jwtToken: string | undefined;
    const isAuthenticated = vi.fn().mockResolvedValue({ isAuthenticated: true, isError: false });
    const getNodeSettings = vi
      .fn()
      .mockResolvedValue({ storageConfig: { storageMode: 'filesystem' } });
    const getNodeMetrics = vi.fn().mockResolvedValue({
      storageMode: 'filesystem',
      mediaBytes: 99,
      availableBytes: 100,
      totalBytes: 200,
    });
    const controller = new SettingsController(
      { paths: { data: directory } } as never,
      { isAuthenticated, getNodeSettings, getStorageMetrics: getNodeMetrics } as never,
      {} as never,
      {} as never
    );
    const app = Fastify();
    app.addHook('onRequest', (request, _reply, done) => {
      request.session = { jwtToken } as typeof request.session;
      done();
    });
    app.get('/settings/metrics/:target', controller.apiGetMetrics);
    try {
      expect((await app.inject('/settings/metrics/client')).statusCode).toBe(401);
      expect(getNodeSettings).not.toHaveBeenCalled();
      jwtToken = 'test-token';
      isAuthenticated.mockResolvedValueOnce({ isAuthenticated: false, isError: false });
      expect((await app.inject('/settings/metrics/node')).statusCode).toBe(401);
      await mkdir(path.join(directory, 'media'));
      await writeFile(path.join(directory, 'media', 'source.mp4'), Buffer.alloc(32));
      const response = await app.inject('/settings/metrics/client');
      expect(response.json<{ metrics: StorageMetrics }>().metrics.mediaBytes).toBe(32);
      expect(response.headers['cache-control']).toBe('no-store');
      const node = await app.inject('/settings/metrics/node');
      expect(node.json<{ metrics: StorageMetrics }>().metrics.mediaBytes).toBe(99);
      expect(getNodeMetrics).toHaveBeenCalledWith('test-token');
      getNodeSettings.mockResolvedValueOnce({ storageConfig: { storageMode: 's3provider' } });
      const s3 = await app.inject('/settings/metrics/node');
      expect(s3.json<{ metrics: StorageMetrics }>().metrics).toEqual({
        storageMode: 's3provider',
        mediaBytes: null,
        availableBytes: null,
        totalBytes: null,
      });
      expect(getNodeMetrics).toHaveBeenCalledTimes(1);
      getNodeMetrics.mockRejectedValueOnce(new Error('Node unavailable'));
      expect((await app.inject('/settings/metrics/node')).statusCode).toBe(500);
      expect((await app.inject('/settings/metrics/unknown')).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
