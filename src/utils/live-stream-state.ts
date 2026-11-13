import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

export interface LiveStreamState {
  generation: string;
  nextSegmentIndex: number;
  lengthSeconds: number;
  discontinuities: number;
  resolution: string;
  isRecordingStreamRemotely: boolean;
  isRecordingStreamLocally: boolean;
}

export function readLiveStreamState(videoDirectory: string): LiveStreamState | undefined {
  try {
    const state = JSON.parse(
      readFileSync(path.join(videoDirectory, 'live-state.json'), 'utf8')
    ) as LiveStreamState;
    if (
      typeof state.generation !== 'string' ||
      !/^[\w-]+$/.test(state.generation) ||
      typeof state.resolution !== 'string' ||
      !/^\d+p$/.test(state.resolution) ||
      typeof state.isRecordingStreamRemotely !== 'boolean' ||
      typeof state.isRecordingStreamLocally !== 'boolean' ||
      !Number.isSafeInteger(state.nextSegmentIndex) ||
      state.nextSegmentIndex < 0 ||
      !Number.isFinite(state.lengthSeconds) ||
      state.lengthSeconds < 0 ||
      !Number.isSafeInteger(state.discontinuities) ||
      state.discontinuities < 0
    ) {
      throw new Error('Invalid saved stream state');
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export function saveLiveStreamState(videoDirectory: string, state: LiveStreamState): void {
  const file = path.join(videoDirectory, 'live-state.json');
  writeFileSync(file + '.part', JSON.stringify(state));
  renameSync(file + '.part', file);
}
