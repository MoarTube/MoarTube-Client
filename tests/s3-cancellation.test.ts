import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import pino from 'pino';
import { S3Service } from '../src/services/s3.js';
import { Logger } from '../src/utils/logger.js';
import { siloFixture, type SiloFixture } from './support/silo.js';

let fixture: SiloFixture;
let service: S3Service;
let directory: string;
beforeEach(async () => {
  fixture = await siloFixture();
  service = new S3Service(new Logger({}, pino({ level: 'silent' })));
  directory = await fs.promises.mkdtemp(path.join(tmpdir(), 'moartube-s3-cancel-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  service.close();
  await fixture.close();
  await fs.promises.rm(directory, { recursive: true, force: true });
});

describe('real S3 upload cancellation boundaries', () => {
  it.each([1, 2])(
    'cancels during file stat %s without publishing and releases admission for retry',
    async (pauseAt) => {
      const filePath = path.join(directory, 'source.txt');
      await fs.promises.writeFile(filePath, 'complete media bytes');
      const files = [{ key: 'cancelled-media', filePath, contentType: 'text/plain' }];
      const original = fs.promises.stat.bind(fs.promises);
      let calls = 0,
        entered = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Delay a real stat result to place cancellation precisely at the asynchronous boundary.
      const stat = vi.spyOn(fs.promises, 'stat').mockImplementation(async (file, options) => {
        const result = await original(file, options);
        if (file === filePath && ++calls === pauseAt) {
          entered = true;
          await gate;
        }
        return result;
      });
      const aborter = new AbortController();
      const progress = vi.fn();
      const upload = service.uploadFilesWithProgress(
        fixture.config,
        files,
        progress,
        aborter.signal
      );
      const settled = Promise.allSettled([upload]);
      try {
        await vi.waitFor(() => {
          expect(entered).toBe(true);
        });
        aborter.abort();
        release();
        await expect(upload).rejects.toThrow();
        expect(progress).not.toHaveBeenCalledWith(100);
        await expect(fixture.text('cancelled-media')).rejects.toMatchObject({
          $metadata: { httpStatusCode: 404 },
        });
        stat.mockRestore();
        await service.uploadFilesWithProgress(fixture.config, files, progress);
        expect(progress).toHaveBeenLastCalledWith(100);
        expect(await fixture.text('cancelled-media')).toBe('complete media bytes');
      } finally {
        release();
        await settled;
      }
    }
  );
});
