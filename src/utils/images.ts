import { createRequire } from 'node:module';
import type { ImageOutput } from './image-runtime/client.cjs';
import type * as ImageRuntime from './image-runtime/client.cjs';
import { trackMediaProcess } from './media-processes.js';

// The worker stays a real CJS file in development, npm and Electron builds.
// Keep this runtime require explicit so bundlers do not inline its __dirname.
const runtime = createRequire(import.meta.url)('./image-runtime/client.cjs') as typeof ImageRuntime;
export { type ImageOutput };
export const VIDEO_IMAGES: readonly ImageOutput[] = [
  { width: 100, height: 100, format: 'jpeg' },
  { width: 512, height: 288, format: 'jpeg' },
  { width: 1280, height: 720, format: 'jpeg' },
];

export async function renderImages(
  input: Buffer | string,
  outputs: readonly ImageOutput[],
  ffmpegPath: string,
  signal?: AbortSignal
): Promise<Buffer[]> {
  return runtime.renderImages(input, outputs, {
    ffmpegPath,
    onProcess: trackMediaProcess,
    ...(signal ? { signal } : {}),
  });
}
