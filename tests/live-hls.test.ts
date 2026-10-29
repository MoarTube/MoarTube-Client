import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readLiveHls, withLiveHlsFiles } from '../src/utils/live-hls.js';

async function fixture(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'moartube-live-hls-'));
}
async function clean(directory: string): Promise<void> {
  if (
    path.dirname(directory) !== path.resolve(tmpdir()) ||
    !path.basename(directory).startsWith('moartube-live-hls-')
  ) {
    throw new Error('Unexpected HLS fixture directory');
  }
  await rm(directory, { recursive: true, force: true });
}
const completed = (): { finished(): boolean; stopping(): boolean; signal: AbortSignal } => ({
  finished: () => true,
  stopping: () => false,
  signal: new AbortController().signal,
});

it('replaces invalid implicit pipe segment URLs with atomic bounded rolling HLS files', () => {
  const args = withLiveHlsFiles(
    ['-c:v', 'h264_nvenc', '-hls_list_size', '20', 'pipe:1'],
    '/encoder/live.m3u8',
    '360p'
  );
  expect(args).toContain('delete_segments+temp_file');
  expect(args.at(-1)).toBe('/encoder/live.m3u8');
  expect(args[args.indexOf('-hls_segment_filename') + 1]).toBe(
    path.join('/encoder', 'segment-360p-%d.ts')
  );
  expect(args).not.toContain('pipe:1');
  expect(args[args.indexOf('-c:v') + 1]).toBe('h264_nvenc');
});

it('delivers each closed segment exactly once and never advertises a future unuploaded segment', async () => {
  const directory = await fixture();
  try {
    const playlist = path.join(directory, 'live.m3u8');
    const header = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n';
    await writeFile(
      playlist,
      header +
        '#EXTINF:2,\nhttps://node.test/segments/segment-360p-0.ts\n#EXTINF:2,\nhttps://node.test/segments/segment-360p-1.ts\n#EXT-X-ENDLIST\n'
    );
    await writeFile(path.join(directory, 'segment-360p-0.ts'), 'first');
    await writeFile(path.join(directory, 'segment-360p-1.ts'), 'second');
    const frames: string[] = [];
    for await (const frame of readLiveHls(playlist, '360p', completed())) {
      frames.push(frame.segmentBuffer.toString() + frame.manifestBuffer.toString());
    }
    expect(frames).toHaveLength(2);
    expect(frames[0]).toBe(
      'first' + header + '#EXTINF:2,\nhttps://node.test/segments/segment-360p-0.ts\n'
    );
    expect(frames[1]).toContain('second');
    expect(frames[1]).toContain('segment-360p-1.ts\n');
    expect(frames[1]).not.toContain('#EXT-X-ENDLIST');
  } finally {
    await clean(directory);
  }
});

it('fails if delivery fell behind retained segments or if a playlist attempts an unexpected file path', async () => {
  const directory = await fixture();
  try {
    const playlist = path.join(directory, 'live.m3u8');
    const collect = async (): Promise<void> => {
      for await (const _frame of readLiveHls(playlist, '360p', completed())) {
        /* drain */
      }
    };
    await writeFile(playlist, '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\nsegment-360p-1.ts\n');
    await expect(collect()).rejects.toThrow('fell behind');
    await writeFile(playlist, '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2,\n../../outside.ts\n');
    await expect(collect()).rejects.toThrow('Unexpected live HLS segment path');
  } finally {
    await clean(directory);
  }
});

it('does not queue later files while segment upload is backpressured and can stop promptly', async () => {
  const directory = await fixture();
  try {
    const playlist = path.join(directory, 'live.m3u8');
    await writeFile(
      playlist,
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2,\nsegment-360p-0.ts\n#EXTINF:2,\nsegment-360p-1.ts\n'
    );
    await writeFile(path.join(directory, 'segment-360p-0.ts'), 'first');
    const aborter = new AbortController();
    let stopped = false;
    const reader = readLiveHls(playlist, '360p', {
      finished: () => false,
      stopping: () => stopped,
      signal: aborter.signal,
    });
    expect((await reader.next()).value?.segmentBuffer.toString()).toContain('first');
    // If the next file were read eagerly, its temporary absence would already fail.
    await writeFile(path.join(directory, 'segment-360p-1.ts'), 'second');
    expect((await reader.next()).value?.segmentBuffer.toString()).toContain('second');
    stopped = true;
    aborter.abort();
    await expect(reader.next()).rejects.toMatchObject({ name: 'AbortError' });
    await reader.return();
  } finally {
    await clean(directory);
  }
});

it('follows an advancing rolling window without dropping or repeating a segment', async () => {
  const directory = await fixture();
  try {
    const playlist = path.join(directory, 'live.m3u8');
    await writeFile(playlist, '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2,\nsegment-360p-0.ts\n');
    await writeFile(path.join(directory, 'segment-360p-0.ts'), 'zero');
    let finished = false;
    const reader = readLiveHls(playlist, '360p', {
      finished: () => finished,
      stopping: () => false,
      signal: new AbortController().signal,
    });
    expect((await reader.next()).value?.segmentBuffer.toString()).toBe('zero');
    await writeFile(path.join(directory, 'segment-360p-1.ts'), 'one');
    await writeFile(
      playlist,
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\nsegment-360p-1.ts\n#EXT-X-ENDLIST\n'
    );
    const next = await reader.next();
    expect(next.value?.segmentBuffer.toString()).toBe('one');
    expect(next.value?.manifestBuffer.toString()).toContain('#EXT-X-MEDIA-SEQUENCE:1');
    finished = true;
    expect((await reader.next()).done).toBe(true);
  } finally {
    await clean(directory);
  }
});

it('rejects oversized playlists and segments before reading them into memory', async () => {
  const directory = await fixture();
  try {
    const playlist = path.join(directory, 'live.m3u8');
    const collect = async (): Promise<void> => {
      for await (const _files of readLiveHls(playlist, '360p', completed())) {
        /* drain */
      }
    };
    await writeFile(playlist, Buffer.alloc(128 * 1024 + 1));
    await expect(collect()).rejects.toThrow('exceeds byte limit');
    await writeFile(playlist, '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2,\nsegment-360p-0.ts\n');
    const segment = await open(path.join(directory, 'segment-360p-0.ts'), 'w');
    try {
      await segment.truncate(64 * 1024 ** 2 + 1);
    } finally {
      await segment.close();
    }
    await expect(collect()).rejects.toThrow('exceeds byte limit');
  } finally {
    await clean(directory);
  }
});
