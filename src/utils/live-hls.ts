import { open } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface LiveHlsSegment {
  segmentBuffer: Buffer;
  manifestBuffer: Buffer;
}

/** Standard, atomic HLS files; pipe:N.ts is not a valid FFmpeg pipe descriptor. */
export function withLiveHlsFiles(args: string[], playlist: string, resolution: string): string[] {
  if (args.at(-1) !== 'pipe:1' || !/^\d+p$/.test(resolution)) {
    throw new Error('Expected the generated live HLS output and a valid resolution');
  }
  return [
    ...args.slice(0, -1),
    '-hls_flags',
    'delete_segments+temp_file',
    '-hls_delete_threshold',
    '1',
    '-hls_segment_filename',
    path.join(path.dirname(playlist), `segment-${resolution}-%d.ts`),
    playlist,
  ];
}

async function readBounded(file: string, limit: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size <= 0 || size > limit) {
      throw new Error('Live HLS file is empty or exceeds byte limit');
    }
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
      if (bytesRead === 0) {
        throw new Error('Live HLS file was truncated');
      }
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Read only closed segments named by an atomically published rolling playlist.
 * Delivery is serial and bounded; a slow consumer fails rather than silently losing segments.
 */
export async function* readLiveHls(
  playlist: string,
  resolution: string,
  state: { finished(): boolean; stopping(): boolean; signal: AbortSignal }
): AsyncGenerator<LiveHlsSegment, void> {
  let next = 0;
  while (!state.stopping()) {
    const finished = state.finished();
    let bytes: Buffer;
    try {
      bytes = await readBounded(playlist, 128 * 1024);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      if (finished) {
        return;
      }
      await delay(100, undefined, { signal: state.signal });
      continue;
    }
    const lines = bytes.toString('utf8').trimEnd().split(/\r?\n/);
    const sequence = lines.find((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
    const start = Number(sequence?.split(':')[1]);
    if (!lines.includes('#EXTM3U') || !Number.isSafeInteger(start) || start < 0) {
      throw new Error('Invalid live HLS media sequence');
    }
    if (next < start) {
      throw new Error('Live HLS delivery fell behind the retained segment window');
    }
    let index = start;
    for (const [lineIndex, line] of lines.entries()) {
      if (line === '' || line.startsWith('#')) {
        continue;
      }
      const name = `segment-${resolution}-${String(index)}.ts`;
      if (line !== name && !line.endsWith('/' + name)) {
        throw new Error('Unexpected live HLS segment path');
      }
      if (index === next) {
        const segment = await readBounded(path.join(path.dirname(playlist), name), 64 * 1024 ** 2);
        // Cut the snapshot at this segment so a later URI is never advertised before upload.
        const manifest = Buffer.from(lines.slice(0, lineIndex + 1).join('\n') + '\n');
        yield { segmentBuffer: segment, manifestBuffer: manifest };
        next++;
      }
      index++;
    }
    if (finished || lines.includes('#EXT-X-ENDLIST')) {
      return;
    }
    await delay(100, undefined, { signal: state.signal });
  }
}
