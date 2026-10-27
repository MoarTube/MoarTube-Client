import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlaylistArchive } from '../src/utils/playlist-archive.js';
describe('disk-backed recorded playlist', () => {
  it('retains the complete timeline without retaining an array of segment entries', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'moartube-playlist-test-'));
    const file = path.join(directory, 'archive.m3u8');
    const archive = new PlaylistArchive(file);
    try {
      for (let i = 0; i < 1000; i++) {
        await archive.append(i === 999 ? 5.1 : 2, `https://example.test/segment-${String(i)}.ts`);
      }
      const text = await readFile(file, 'utf8');
      expect(text.match(/#EXTINF/g)).toHaveLength(1000);
      expect(text).toContain('segment-0.ts');
      expect(text).toContain('segment-999.ts');
      expect(text).toMatch(/#EXT-X-TARGETDURATION:0*6\n/);
      expect(Object.values(archive).some((value) => Array.isArray(value))).toBe(false);
    } finally {
      await archive.close();
      expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
      expect(path.basename(directory).startsWith('moartube-playlist-test-')).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
