import { describe, expect, it } from 'vitest';
import { recoveredEncoderHlsLine } from '../src/utils/recovered-hls.js';

const route = '/external/videos/video123/adaptive/m3u8/720p/segments/segment-720p-0.ts';
describe('legacy local encoder recovery', () => {
  it('recognizes only the exact video, rendition and encoder segment filename', () => {
    expect(
      recoveredEncoderHlsLine('https://old.test/bucket' + route, 'video123', '720p', [], true)
    ).toBe('../../720p/segments/segment-720p-0.ts');
    for (const value of [
      route.replace('segment-720p-0.ts', 'foreign.ts'),
      route.replace('segment-720p-0.ts', 'key.bin'),
    ]) {
      expect(() =>
        recoveredEncoderHlsLine('https://old.test' + value, 'video123', '720p', [], true)
      ).toThrow('previous media base');
    }
    for (const value of [route.replace('video123', 'another')]) {
      expect(
        recoveredEncoderHlsLine('https://old.test' + value, 'video123', '720p', [], true)
      ).toBe('https://old.test' + value);
    }
    expect(() =>
      recoveredEncoderHlsLine(
        'https://old.test' + route.replaceAll('720p', '360p'),
        'video123',
        '720p',
        [],
        true
      )
    ).toThrow('previous media base');
  });
  it('keeps signed references and external keys unchanged and applies strict policy after upgrade', () => {
    for (const value of [
      'https://old.test' + route + '?signature=secret',
      'https://user:password@old.test' + route,
      '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.test/key"',
    ]) {
      expect(recoveredEncoderHlsLine(value, 'video123', '720p', [], true)).toBe(value);
    }
    expect(() =>
      recoveredEncoderHlsLine('https://old.test' + route, 'video123', '720p', [], false)
    ).toThrow('previous media base');
  });
});
