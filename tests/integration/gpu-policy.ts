import type { GpuCapability } from '../../src/services/ffmpeg.js';

export function selectRequiredGpus(devices: GpuCapability[], requested = 'all'): GpuCapability[] {
  if (!['all', 'nvenc', 'amf', 'qsv'].includes(requested)) {
    throw new Error('GPU backend must be all, nvenc, amf or qsv.');
  }
  const selected = devices.filter((device) => requested === 'all' || device.backend === requested);
  if (selected.length === 0) {
    throw new Error(
      `No GPU found for required backend ${requested}; CPU fallback is not permitted.`
    );
  }
  for (const device of selected) {
    if (!device.available || !['nvenc', 'amf', 'qsv'].includes(device.backend ?? '')) {
      throw new Error(
        `Required GPU ${device.id} is unavailable: ${device.unavailableReason ?? 'unsupported backend'}`
      );
    }
  }
  return selected;
}

/** Assert the actual generated command before launching it, rather than trusting UI selection. */
export function assertWindowsHardwarePipeline(args: string[], backend: string): void {
  const pipelines: Record<string, string[]> = {
    nvenc: ['h264_nvenc', 'cuda', 'cuda', 'scale_cuda='],
    amf: ['h264_amf', 'd3d11va', 'd3d11', 'vpp_amf='],
    qsv: ['h264_qsv', 'qsv', 'qsv', 'vpp_qsv='],
  };
  const expected = pipelines[backend];
  if (expected === undefined) {
    throw new Error(`Unsupported Windows hardware backend: ${backend}`);
  }
  const outputEncoder = args[args.lastIndexOf('-c:v') + 1];
  const value = (option: string): string | undefined => {
    const index = args.indexOf(option);
    return index < 0 ? undefined : args[index + 1];
  };
  const filter = value('-vf') ?? '';
  if (
    outputEncoder !== expected[0] ||
    value('-hwaccel') !== expected[1] ||
    value('-hwaccel_output_format') !== expected[2] ||
    !filter.startsWith(expected[3] ?? '') ||
    value('-init_hw_device') === undefined ||
    value('-filter_hw_device') === undefined ||
    /hwdownload|hwupload|(?:^|[,;])\s*(?:scale|crop)=/.test(filter)
  ) {
    throw new Error(
      `Required ${backend} hardware decode/scaling/encode pipeline was replaced: ${JSON.stringify(args)}`
    );
  }
}
