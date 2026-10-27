import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  uploads: [] as { queueSize: number; partSize: number; client: unknown; release(): void }[],
}));
vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    promise: Promise<void>;
    constructor(options: { queueSize: number; partSize: number; client: unknown }) {
      this.promise = new Promise((resolve) => state.uploads.push({ ...options, release: resolve }));
    }
    done() {
      return this.promise;
    }
  },
}));
import { S3Service } from '../src/services/s3.js';
import type { Logger } from '../src/utils/logger.js';
describe('shared S3 upload budget', () => {
  it('bounds uploads across calls, configures one part per upload and reuses the client', async () => {
    const service = new S3Service({ error: vi.fn() } as unknown as Logger);
    const config = {
      bucketName: 'test',
      s3ProviderClientConfig: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      },
    };
    const jobs = Array.from({ length: 6 }, (_, i) =>
      service.putObjectFromData(config, String(i), Buffer.from('a'), 'text/plain')
    );
    await vi.waitFor(() => {
      expect(state.uploads.length).toBe(4);
    });
    expect(
      state.uploads.every((upload) => upload.queueSize === 1 && upload.partSize === 5 * 1024 ** 2)
    ).toBe(true);
    expect(new Set(state.uploads.map((upload) => upload.client)).size).toBe(1);
    state.uploads.forEach((upload) => {
      upload.release();
    });
    await vi.waitFor(() => {
      expect(state.uploads.length).toBe(6);
    });
    state.uploads.forEach((upload) => {
      upload.release();
    });
    await Promise.all(jobs);
    service.close();
  });
});
