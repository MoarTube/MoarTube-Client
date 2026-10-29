import { expect, it } from 'vitest';
import type { GpuCapability } from '../src/services/ffmpeg.js';
import { selectRequiredGpus, assertWindowsHardwarePipeline } from './integration/gpu-policy.js';
import { getGpuProbeArguments } from '../src/utils/gpu-encoding.js';

const device = (id: string, backend: 'nvenc' | 'amf' | 'qsv', available = true): GpuCapability => ({
  id,
  backend,
  available,
  deviceIndex: 0,
  processingAgentName: backend === 'nvenc' ? 'NVIDIA' : backend === 'amf' ? 'AMD' : 'Intel',
  processingAgentModel: 'test adapter',
});

it('requires every detected adapter in all mode and never treats absent/unavailable hardware as a pass', () => {
  const devices = [device('a', 'nvenc'), device('b', 'nvenc'), device('c', 'amf', false)];
  expect(selectRequiredGpus(devices, 'nvenc').map((gpu) => gpu.id)).toEqual(['a', 'b']);
  expect(() => selectRequiredGpus(devices)).toThrow('unavailable');
  expect(() => selectRequiredGpus([], 'all')).toThrow('No GPU');
  expect(() => selectRequiredGpus(devices, 'qsv')).toThrow('No GPU');
  expect(() => selectRequiredGpus(devices, 'cpu')).toThrow('GPU backend');
});

for (const backend of ['nvenc', 'amf', 'qsv'] as const) {
  it(`rejects CPU decoding, scaling, encoding and GPU-to-CPU transfers for ${backend}`, () => {
    const gpu = device('adapter', backend);
    const args = getGpuProbeArguments({ ...gpu, processingAgentType: 'gpu' }, 'compressed.h264');
    expect(() => {
      assertWindowsHardwarePipeline(args, backend);
    }).not.toThrow();
    for (const [option, replacement] of [
      ['-hwaccel', 'none'],
      ['-hwaccel_output_format', 'yuv420p'],
      ['-c:v', 'libx264'],
      ['-vf', 'scale=640:360'],
    ] as const) {
      const changed = [...args];
      changed[changed.lastIndexOf(option) + 1] = replacement;
      expect(() => {
        assertWindowsHardwarePipeline(changed, backend);
      }).toThrow('pipeline was replaced');
    }
    const transfer = [...args];
    const filterIndex = transfer.indexOf('-vf') + 1;
    transfer[filterIndex] = `${transfer[filterIndex] ?? ''},hwdownload,format=nv12`;
    expect(() => {
      assertWindowsHardwarePipeline(transfer, backend);
    }).toThrow('pipeline was replaced');
  });
}
