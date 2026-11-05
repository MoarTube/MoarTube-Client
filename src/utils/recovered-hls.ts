import { hlsPlaylistPath, relativeHlsLine } from './hls-urls.js';

/** Only local encoder output, after the recovery job's Node connection was checked. */
export function recoveredEncoderHlsLine(
  line: string,
  videoId: string,
  resolution: string,
  bases: string[],
  legacy: boolean
): string {
  const playlist = hlsPlaylistPath(videoId, `manifest-${resolution}.m3u8`);
  if (legacy && !line.startsWith('#')) {
    try {
      const url = new URL(line.trim());
      const route = `/external/videos/${encodeURIComponent(videoId)}/adaptive/m3u8/${resolution}/segments/`;
      const index = url.pathname.indexOf(route);
      const filename = url.pathname.slice(index + route.length);
      if (
        index >= 0 &&
        /^https?:$/.test(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        filename.startsWith(`segment-${resolution}-`) &&
        /^\d+\.ts$/.test(filename.slice(`segment-${resolution}-`.length))
      ) {
        bases = [...bases, url.origin + url.pathname.slice(0, index)];
      }
    } catch {
      // Relative, signed, and unrelated references retain the normal strict policy.
    }
  }
  return relativeHlsLine(line, playlist, bases);
}
