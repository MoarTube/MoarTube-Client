import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { ChildProcess } from 'node:child_process';

interface LiveStream {
  uuid: string;
  process: ChildProcess;
}

export class StreamsTrackerService extends BaseService {
  private liveStreams: LiveStream[] = [];

  constructor(logger: Logger) {
    super('streamsTrackerService', logger);
  }

  public addLiveStream(uuid: string, process: ChildProcess): void {
    this.liveStreams.push({ uuid, process });
    this.logger.debug(`Added live stream ${uuid}`);
  }

  public removeLiveStream(uuid: string): void {
    const index = this.liveStreams.findIndex((ls) => ls.uuid === uuid);
    if (index > -1) {
      this.liveStreams.splice(index, 1);
      this.logger.debug(`Removed live stream ${uuid}`);
    }
  }

  public getLiveStream(uuid: string): LiveStream | undefined {
    return this.liveStreams.find((ls) => ls.uuid === uuid);
  }
}
