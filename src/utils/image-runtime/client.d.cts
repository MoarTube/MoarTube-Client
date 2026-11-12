import type { ChildProcess } from 'node:child_process';
export interface ImageOutput {
  width: number;
  height: number;
  format: 'png' | 'jpeg';
}
export function renderImages(
  input: Buffer | string,
  outputs: readonly ImageOutput[],
  options: {
    ffmpegPath: string;
    signal?: AbortSignal;
    onProcess?: (child: ChildProcess) => void;
  }
): Promise<Buffer[]>;
export function stopImages(): Promise<void>;
