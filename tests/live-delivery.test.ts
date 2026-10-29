import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { LiveStreamService } from '../src/services/live-stream.js';
import { PlaylistArchive } from '../src/utils/playlist-archive.js';

describe('recorded live delivery', () => {
  it('streams a complete recording from closed segments and rolling playlist snapshots', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'moartube-live-test-'));
    const archive = new PlaylistArchive(path.join(directory, 'archive.m3u8'));
    let lastManifest = '',
      uploads = 0;
    const api = {
      uploadStream: vi.fn(
        async (_token: string, options: { segmentBuffer: Buffer; manifestBuffer: Readable }) => {
          uploads++;
          expect(options.segmentBuffer.toString()).toBe(`segment-${String(uploads - 1)}`);
          let content = '';
          for await (const chunk of options.manifestBuffer) {
            content += (chunk as Buffer).toString();
          }
          lastManifest = content;
        }
      ),
      getVideoBandwidth: vi.fn().mockResolvedValue({ isError: true }),
    };
    const service = new LiveStreamService(
      {} as never,
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
    internal.lastVideoImagesUpdateTimestamp = Date.now();
    const context = {
      archive,
      segmentCounter: -1,
      nextExpectedSegmentIndex: 0,
      endOfValidManifestPattern: Buffer.from('segment-720p-0.ts\n'),
      endOfValidManifestPatternLength: 18,
    };
    context.endOfValidManifestPatternLength = context.endOfValidManifestPattern.length;
    async function* encoder() {
      await Promise.resolve();
      for (let index = 0; index < 50; index++) {
        const start = Math.max(0, index - 19);
        let text = `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:${String(start)}\n`;
        for (let i = start; i <= index; i++) {
          text += `#EXTINF:2,\nhttps://example.test/pipe${String(i)}.ts\n`;
        }
        yield {
          segmentBuffer: Buffer.from(`segment-${String(index)}`),
          manifestBuffer: Buffer.from(text),
        };
      }
    }
    try {
      for await (const files of encoder()) {
        await internal.handleStreamData({
          ...files,
          context,
          jwtToken: 'token',
          videoId: 'video',
          resolution: '720p',
          storageConfig: { storageMode: 'filesystem' },
          isCloudflareCdnEnabled: false,
          externalVideosBaseUrl: '',
          isRecordingStreamLocally: false,
          isRecordingStreamRemotely: true,
          lengthTimestamp: '',
          format: 'm3u8',
          sourceFilePath: '',
        });
      }
      expect(uploads).toBe(50);
      expect(lastManifest.match(/#EXTINF/g)).toHaveLength(50);
      expect(lastManifest).toContain('segment-720p-0.ts');
      expect(lastManifest).toContain('segment-720p-49.ts');
    } finally {
      await archive.close();
      expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
      expect(path.basename(directory).startsWith('moartube-live-test-')).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
