import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { LiveStreamService } from '../src/services/live-stream.js';
import { DEFAULT_CLIENT_SETTINGS } from '../src/config/defaults.js';
import { spawnMediaProcess } from '../src/utils/media-processes.js';
import { readLiveStreamState } from '../src/utils/live-stream-state.js';
import type { LiveStreamState } from '../src/utils/live-stream-state.js';
import type { UploadStreamOptions } from '../src/services/node-api.js';
import type { ChildProcess } from 'node:child_process';

vi.mock('../src/services/live-stream-images.js', () => ({
  LiveStreamImages: class {
    enqueue(): void {}
    finish(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('../src/utils/media-processes.js', () => ({ spawnMediaProcess: vi.fn() }));

describe('stop, resume and restart live streams', () => {
  it.each([
    ['filesystem', true],
    ['filesystem', false],
    ['s3provider', true],
    ['s3provider', false],
  ] as const)(
    'continues counters and recordings with %s storage, remote recording=%s',
    async (storageMode, recording) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'moartube-stream-resume-'));
      const uploads: { name: string; manifest: string }[] = [];
      const objects = new Map<string, string>();
      const read = async (value: Buffer | Readable): Promise<string> => {
        if (Buffer.isBuffer(value)) {
          return value.toString();
        }
        let result = '';
        for await (const chunk of value) {
          result += String(chunk);
        }
        return result;
      };
      const api = {
        getNodeSettings: vi
          .fn()
          .mockResolvedValue({ storageConfig: { storageMode, s3Config: {} } }),
        getVideoData: vi.fn().mockResolvedValue({
          isError: false,
          videoData: {
            isLive: true,
            isStreaming: false,
            isFinalized: false,
            lengthSeconds: 2,
            meta: {
              resolution: '720p',
              isRecordingStreamRemotely: recording,
              isRecordingStreamLocally: true,
            },
          },
        }),
        uploadStream: vi.fn(async (_token: string, options: UploadStreamOptions) => {
          uploads.push({
            name: options.segmentFileName,
            manifest: await read(options.manifestBuffer),
          });
          return { isError: false };
        }),
        withVideoCacheInvalidation: vi.fn(
          (_token: string, _video: string, _paths: string[], action: () => Promise<unknown>) =>
            action()
        ),
        getVideoBandwidth: vi.fn().mockResolvedValue({ isError: true }),
        setVideoLengths: vi.fn().mockResolvedValue({ isError: false }),
        stopVideoStreaming: vi.fn().mockResolvedValue({ isError: false }),
      };
      const s3 = {
        deleteDirectoryRecursive: vi.fn(() => {
          objects.clear();
          return Promise.resolve();
        }),
        putObjectFromData: vi.fn(async (_config: unknown, key: string, data: Buffer | Readable) => {
          objects.set(key, await read(data));
        }),
      };
      const master = { refreshMasterManifest: vi.fn().mockResolvedValue(undefined) };
      let child: ChildProcess & { stderr: PassThrough };
      function makeChild(): ChildProcess & { stderr: PassThrough } {
        const process = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          exitCode: null as number | null,
          signalCode: null as string | null,
          kill: vi.fn(() => {
            process.signalCode = 'SIGTERM';
            queueMicrotask(() => process.emit('close', 0));
            return true;
          }),
        });
        return process as unknown as ChildProcess & { stderr: PassThrough };
      }
      vi.mocked(spawnMediaProcess).mockImplementation((_file, args) => {
        child = makeChild();
        const index = Number(args[args.indexOf('-start_number') + 1]);
        const playlist = String(args.at(-1));
        writeFileSync(
          path.join(path.dirname(playlist), `segment-720p-${String(index)}.ts`),
          `bytes-${String(index)}`
        );
        writeFileSync(
          playlist,
          `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${String(index)}\n#EXTINF:2,\n../../720p/segments/segment-720p-${String(index)}.ts\n`
        );
        return child as never;
      });
      const createService = (): LiveStreamService => {
        const service = new LiveStreamService(
          { info: vi.fn(), error: vi.fn() } as never,
          api as never,
          s3 as never,
          {
            getVideosDirectoryPath: () => directory,
            getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
          } as never,
          { broadcastToUser: vi.fn() } as never,
          master as never,
          { getPath: () => 'encoder' } as never
        );
        return service;
      };
      let service = createService();
      const videoDir = path.join(directory, 'video');
      const checkpoint = (): LiveStreamState | undefined => readLiveStreamState(videoDir);
      async function start(resume = false): Promise<void> {
        const state = resume
          ? await service.prepareStreamResume('token', 'video', '720p', recording, true)
          : undefined;
        await service.performStreamingJob(
          'token',
          'video',
          'rtmp://127.0.0.1/live',
          'm3u8',
          '720p',
          recording,
          true,
          state
        );
        await vi.waitFor(() => {
          expect(checkpoint()?.nextSegmentIndex).toBe(resume ? 2 : 1);
        });
        child.stderr.write(`time=00:00:0${resume ? '3' : '2'}.00 `);
        await vi.waitFor(() => {
          expect(api.setVideoLengths).toHaveBeenLastCalledWith(
            'token',
            'video',
            resume ? 5 : 2,
            resume ? '00:00:05.00' : '00:00:02.00'
          );
        });
      }
      async function stop(): Promise<void> {
        await service.stopLiveStream('video');
        await vi.waitFor(() => {
          expect(service.liveStreamExists('video')).toBe(false);
        });
      }
      try {
        await start();
        const generation = checkpoint()?.generation;
        if (generation === undefined) {
          throw new Error('Missing initial stream checkpoint');
        }
        await stop();
        writeFileSync(path.join(videoDir, 'images', 'preserved.jpg'), 'image');
        objects.set('preserved-object', 'data');
        service.close();
        service = createService(); // Resume must survive losing the in-memory tracker.
        await start(true);
        expect(checkpoint()).toMatchObject({ generation, nextSegmentIndex: 2, discontinuities: 1 });
        await stop();
        expect(checkpoint()?.lengthSeconds).toBe(5);
        expect(await readFile(path.join(videoDir, 'source', 'video.ts'), 'utf8')).toBe(
          'bytes-0bytes-1'
        );
        expect(await readFile(path.join(videoDir, 'images', 'preserved.jpg'), 'utf8')).toBe(
          'image'
        );
        if (storageMode === 's3provider') {
          expect(s3.deleteDirectoryRecursive).toHaveBeenCalledTimes(1);
          expect(objects.get('preserved-object')).toBe('data');
          const paths = api.withVideoCacheInvalidation.mock.calls.flatMap((call) => call[2]);
          expect(paths).not.toContain('adaptive/m3u8/');
          expect(
            paths.filter((key) => key.startsWith('adaptive/m3u8/static/manifests/'))
          ).toHaveLength(8);
          const keys = [...objects.keys()].filter((key) => key.endsWith('.ts'));
          expect(keys.some((key) => key.endsWith(`${generation}-0.ts`))).toBe(true);
          expect(keys.some((key) => key.endsWith(`${generation}-1.ts`))).toBe(true);
        }
        const manifest =
          storageMode === 'filesystem'
            ? uploads.at(-1)?.manifest
            : objects.get(
                'external/videos/video/adaptive/m3u8/dynamic/manifests/manifest-720p.m3u8'
              );
        if (manifest === undefined) {
          throw new Error('Missing resumed manifest');
        }
        expect(manifest).toContain(`segment-720p-${generation}-1.ts`);
        expect(manifest).toContain('#EXT-X-DISCONTINUITY\n');
        expect(manifest).not.toContain('#EXT-X-ENDLIST');
        if (recording) {
          expect(manifest.match(/#EXTINF:/g)).toHaveLength(2);
          expect(manifest).toContain(`segment-720p-${generation}-0.ts`);
        } else {
          expect(manifest).toContain('#EXT-X-MEDIA-SEQUENCE:1\n');
        }
        await start(); // Explicit restart uses the original reset behavior.
        await stop();
        expect(checkpoint()?.generation).not.toBe(generation);
        expect(checkpoint()?.nextSegmentIndex).toBe(1);
        expect(checkpoint()?.lengthSeconds).toBe(2);
        expect(await readFile(path.join(videoDir, 'source', 'video.ts'), 'utf8')).toBe('bytes-0');
        if (recording) {
          const archive = await readFile(
            path.join(videoDir, 'adaptive', 'archive-720p.m3u8'),
            'utf8'
          );
          expect(archive.match(/#EXTINF:/g)).toHaveLength(1);
          expect(archive).not.toContain(generation);
        }
      } finally {
        service.close();
        vi.mocked(spawnMediaProcess).mockReset();
        expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
        expect(path.basename(directory).startsWith('moartube-stream-resume-')).toBe(true);
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
});
