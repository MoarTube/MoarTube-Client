import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {
  getQsvScaleFilter,
  getCudaScaleFilter,
  getVaapiScaleFilter,
  getVideoToolboxScaleFilter,
} from '../src/utils/gpu-encoding.js';

describe.each([
  ['VA-API', getVaapiScaleFilter],
  ['VideoToolbox', getVideoToolboxScaleFilter],
  ['Quick Sync', getQsvScaleFilter],
  ['CUDA', getCudaScaleFilter],
] as const)('%s sizing expressions', (_name, getFilter) => {
  // FFmpeg's software and VA-API scalers share the dimension-expression evaluator.
  // Evaluate the expressions on every test host; actual GPU processing is covered
  // separately by the opt-in hardware test.
  it.each([
    ['1280x720', '360p', '640x360'],
    ['720x1280', '360p', '202x360'],
    ['853x479', '480p', '854x478'],
    ['479x853', '480p', '268x480'],
    ['721x721', '240p', '426x426'],
  ])('sizes %s at %s to even %s frames without a software crop', (source, resolution, expected) => {
    const expression = getFilter(resolution)
      .replace(/^(scale_vaapi|scale_vt|vpp_qsv|scale_cuda)=/, 'scale=')
      .replace(/:format=nv12$/, '');
    const result = spawnSync(
      ffmpegStatic ?? 'ffmpeg',
      [
        '-hide_banner',
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=${source}:rate=1`,
        '-vf',
        `${expression},showinfo`,
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8', timeout: 10000, windowsHide: true }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`s:${expected}`);
  });
});
