import { open, mkdir, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

/** Only a file handle and the largest duration remain in memory as recordings grow. */
export class PlaylistArchive {
  private handle: FileHandle | undefined;
  private target: number;
  private readonly prefix = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:';
  constructor(
    public readonly file: string,
    targetDuration = 0,
    private readonly resume = false
  ) {
    this.target = targetDuration;
  }
  async append(
    duration: number,
    url: string,
    targetDuration = 0,
    discontinuity = false
  ): Promise<void> {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400 || /[\r\n]/.test(url)) {
      throw new Error('Invalid playlist entry');
    }
    if (!this.handle && this.resume) {
      this.handle = await open(this.file, 'r+');
      const header = Buffer.alloc(256);
      const { bytesRead } = await this.handle.read(header, 0, header.length, 0);
      const target = Number(
        header
          .subarray(0, bytesRead)
          .toString()
          .match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1]
      );
      if (!Number.isInteger(target) || target <= 0) {
        await this.close();
        throw new Error('Invalid recorded playlist target duration');
      }
      this.target = target;
    }
    if (this.target === 0) {
      if (!Number.isInteger(targetDuration) || targetDuration < 0 || targetDuration > 86400) {
        throw new Error('Invalid HLS target duration');
      }
      this.target = Math.max(targetDuration, Math.ceil(duration));
    }
    if (Math.round(duration) > this.target) {
      throw new Error('Recording segment exceeds fixed HLS target duration');
    }
    if (!this.handle) {
      await mkdir(path.dirname(this.file), { recursive: true });
      this.handle = await open(this.file, 'wx+');
      await this.handle.write(
        this.prefix +
          String(this.target).padStart(10, '0') +
          '\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n'
      );
    }
    const entry = `${discontinuity ? '#EXT-X-DISCONTINUITY\n' : ''}#EXTINF:${String(duration)},\n${url}\n`;
    if (this.resume) {
      // Explicit position: reading the header must not overwrite the old timeline.
      await this.handle.write(entry, (await this.handle.stat()).size);
    } else {
      await this.handle.write(entry);
    }
  }
  async close(): Promise<void> {
    await this.handle?.close();
    this.handle = undefined;
  }
}
