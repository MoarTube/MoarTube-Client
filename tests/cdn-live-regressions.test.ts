import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { LiveStreamService } from '../src/services/live-stream.js';
import { PlaylistArchive } from '../src/utils/playlist-archive.js';

afterEach(() => vi.useRealTimers());

function streamHarness(generation: string, failCleanup: boolean | 'response' = false) {
  const api = {
    uploadStream: vi.fn(
      (_token: string, _options: { segmentFileName: string; manifestBuffer: Buffer }) =>
        Promise.resolve({})
    ),
    getVideoBandwidth: vi.fn().mockResolvedValue({ isError: true }),
    removeAdaptiveStreamSegment: vi.fn(
      (_token: string, _video: string, _format: string, _resolution: string, _name: string) => {
        if (failCleanup !== false) {
          const rejection = failCleanup;
          failCleanup = false;
          if (rejection === 'response') {
            return Promise.resolve({ isError: true });
          }
          return Promise.reject(new Error('offline'));
        }
        return Promise.resolve({ isError: false });
      }
    ),
  };
  const service = new LiveStreamService(
    { error: vi.fn() } as never,
    api as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  const internal = service as unknown as {
    lastVideoImagesUpdateTimestamp: number;
    handleStreamData(options: unknown): Promise<void>;
  };
  const pattern = Buffer.from('segment-720p-0.ts\n');
  const context = {
    generation,
    segmentCounter: -1,
    nextExpectedSegmentIndex: 0,
    endOfValidManifestPattern: pattern,
    endOfValidManifestPatternLength: pattern.length,
  };
  async function publish(index: number): Promise<void> {
    internal.lastVideoImagesUpdateTimestamp = Date.now();
    const start = Math.max(0, index - 19);
    let manifest = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${String(start)}\n`;
    for (let segment = start; segment <= index; segment++) {
      manifest += `#EXTINF:2,\nhttps://example.com/external/videos/id/adaptive/m3u8/720p/segments/segment-720p-${String(segment)}.ts\n`;
    }
    await internal.handleStreamData({
      context,
      jwtToken: 'test',
      videoId: 'id',
      resolution: '720p',
      manifestBuffer: Buffer.from(manifest),
      segmentBuffer: Buffer.from(`bytes-${generation}-${String(index)}`),
      storageConfig: { storageMode: 'filesystem' },
      isCloudflareCdnEnabled: true,
      externalVideosBaseUrl: 'https://example.com',
      isRecordingStreamLocally: false,
      isRecordingStreamRemotely: false,
      lengthTimestamp: '',
      format: 'm3u8',
      sourceFilePath: '',
    });
  }
  return { api, publish };
}

describe('CDN live delivery regressions', () => {
  it('does not reuse segment identity on resume or wait for optional CDN downloads', async () => {
    const download = vi.spyOn(axios, 'get').mockImplementation(() => new Promise(() => {}));
    try {
      const first = streamHarness('first-run');
      const second = streamHarness('second-run');
      await first.publish(0);
      await second.publish(0);
      expect(first.api.uploadStream.mock.calls[0]?.[1].segmentFileName).toBe(
        'segment-720p-first-run-0.ts'
      );
      expect(second.api.uploadStream.mock.calls[0]?.[1].segmentFileName).toBe(
        'segment-720p-second-run-0.ts'
      );
      expect(first.api.uploadStream.mock.calls[0]?.[1].manifestBuffer.toString()).toContain(
        'segment-720p-first-run-0.ts'
      );
      expect(download).not.toHaveBeenCalled();
    } finally {
      download.mockRestore();
    }
  });
  it.each([true, 'response'] as const)(
    'retains removed segments through reader grace and retries failed cleanup (%s)',
    async (failure) => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
      const stream = streamHarness('run', failure);
      for (let index = 0; index <= 20; index++) {
        await stream.publish(index);
      }
      expect(stream.api.removeAdaptiveStreamSegment).not.toHaveBeenCalled();
      vi.setSystemTime(146_000);
      await stream.publish(21);
      expect(stream.api.removeAdaptiveStreamSegment).not.toHaveBeenCalled();
      vi.setSystemTime(148_000);
      await stream.publish(22);
      expect(stream.api.removeAdaptiveStreamSegment).toHaveBeenCalledWith(
        'test',
        'id',
        'm3u8',
        '720p',
        'segment-720p-run-0.ts'
      );
      await stream.publish(23);
      const names = stream.api.removeAdaptiveStreamSegment.mock.calls.map((call) => call[4]);
      expect(names.filter((name) => name === 'segment-720p-run-0.ts')).toHaveLength(2);
    }
  );
  it('continues publication while old-segment cleanup is slow', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const stream = streamHarness('slow-cleanup');
    for (let index = 0; index <= 20; index++) {
      await stream.publish(index);
    }
    let release = (): void => {};
    stream.api.removeAdaptiveStreamSegment.mockReturnValueOnce(
      new Promise<{ isError: boolean }>((resolve) => {
        release = () => {
          resolve({ isError: false });
        };
      })
    );
    vi.setSystemTime(148_000);
    await stream.publish(21);
    await stream.publish(22);
    expect(stream.api.uploadStream).toHaveBeenCalledTimes(23);
    release();
  });

  it('keeps recording target duration fixed and rejects contract violations', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'moartube-cdn-archive-'));
    const archive = new PlaylistArchive(path.join(directory, 'archive.m3u8'));
    try {
      await archive.append(0.8, 'segment-0.ts', 2);
      await archive.append(2.3, 'segment-1.ts');
      await expect(archive.append(3.1, 'segment-2.ts')).rejects.toThrow(
        'fixed HLS target duration'
      );
      const text = await readFile(archive.file, 'utf8');
      expect(text).toMatch(/TARGETDURATION:0*2\n/);
      expect(text).not.toContain('segment-2.ts');
    } finally {
      await archive.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
