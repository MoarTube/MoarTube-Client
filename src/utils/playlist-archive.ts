import { open, mkdir, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

/** Only a file handle and the largest duration remain in memory as recordings grow. */
export class PlaylistArchive {
  private handle: FileHandle | undefined;
  private target = 0;
  private readonly prefix = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:';
  constructor(public readonly file: string) {}
  async append(duration: number, url: string): Promise<void> {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400 || /[\r\n]/.test(url)) {
      throw new Error('Invalid playlist entry');
    }
    if (!this.handle) {
      await mkdir(path.dirname(this.file), { recursive: true });
      this.handle = await open(this.file, 'wx+');
      await this.handle.write(
        this.prefix + '0000000001\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n'
      );
    }
    const target = Math.ceil(duration);
    if (target > this.target) {
      this.target = target;
      await this.handle.write(
        String(target).padStart(10, '0'),
        Buffer.byteLength(this.prefix),
        'utf8'
      );
    }
    await this.handle.write(`#EXTINF:${String(duration)},\n${url}\n`);
  }
  async close(): Promise<void> {
    await this.handle?.close();
    this.handle = undefined;
  }
}
