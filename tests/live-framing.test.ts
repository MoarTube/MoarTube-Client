import { describe, expect, it } from 'vitest';
import { readDelimited } from '../src/utils/live-framing.js';

describe('live stream framing', () => {
  it('handles split delimiters and several frames in one read without losing bytes', async () => {
    async function* source() {
      await Promise.resolve();
      yield Buffer.from('a.t');
      yield Buffer.from('s\nb.ts\nc.ts\n');
    }
    const frames = [];
    for await (const frame of readDelimited(source(), Buffer.from('.ts\n'), 1024)) {
      frames.push(frame.toString());
    }
    expect(frames).toEqual(['a.ts\n', 'b.ts\n', 'c.ts\n']);
  });
  it('does not read the next producer chunk while the consumer is delivering a segment', async () => {
    let reads = 0;
    async function* source() {
      await Promise.resolve();
      reads++;
      yield Buffer.from('a.ts\n');
      reads++;
      yield Buffer.from('b.ts\n');
    }
    const iterator = readDelimited(source(), Buffer.from('.ts\n'), 1024);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      expect(first.value.toString()).toBe('a.ts\n');
    }
    expect(reads).toBe(1);
    await iterator.return();
    expect(reads).toBe(1);
  });
  it('fails explicitly when framing exceeds its byte budget or ends mid-frame', async () => {
    const collect = async (chunks: Buffer[], cap: number) => {
      for await (const _frame of readDelimited(
        (async function* () {
          await Promise.resolve();
          yield* chunks;
        })(),
        Buffer.from('.ts\n'),
        cap
      )) {
        /* consume */
      }
    };
    await expect(collect([Buffer.alloc(10), Buffer.alloc(10)], 15)).rejects.toThrow('limit');
    await expect(collect([Buffer.from('partial')], 100)).rejects.toThrow('incomplete');
  });
});
