import type { ClientSettings } from '@/config/index.js';

type Agent = ClientSettings['processingAgent'];

/** Dimensions shared by hardware scalers, including those without -2 support. */
function getHardwareScaleDimensions(resolution: string): string {
  const dimensions: Record<string, [number, number]> = {
    '2160p': [3840, 2160],
    '1440p': [2560, 1440],
    '1080p': [1920, 1080],
    '720p': [1280, 720],
    '480p': [854, 480],
    '360p': [640, 360],
    '240p': [426, 240],
  };
  const [targetWidth, targetHeight] = (Object.hasOwn(dimensions, resolution)
    ? dimensions[resolution]
    : undefined) ?? [1920, 1080];
  const width = String(targetWidth);
  const height = String(targetHeight);
  // Compute positive even sizes directly. No software crop filter is needed.
  return `w='max(2,trunc(if(gt(ih,iw),${height}*iw/ih,${width})/2)*2)':h='max(2,trunc(if(gt(ih,iw),${height},${width}*ih/iw)/2)*2)'`;
}

/** Preserve portrait/landscape sizing and even dimensions without downloading frames. */
export function getVaapiScaleFilter(resolution: string): string {
  return `scale_vaapi=${getHardwareScaleDimensions(resolution)}:format=nv12`;
}

export function getVideoToolboxScaleFilter(resolution: string): string {
  return `scale_vt=${getHardwareScaleDimensions(resolution)}`;
}

export function getQsvScaleFilter(resolution: string): string {
  return `vpp_qsv=${getHardwareScaleDimensions(resolution)}:format=nv12`;
}

export function getCudaScaleFilter(resolution: string): string {
  return `scale_cuda=${getHardwareScaleDimensions(resolution)}:format=nv12`;
}

/** These hardware backends share the CPU path's HLS/MP4 packaging options. */
export function getHardwareH264Options(
  agent: Agent,
  resolution: string
): { encoder: string; filter: string } | undefined {
  if (agent?.processingAgentType !== 'gpu') {
    return undefined;
  }
  switch (agent.backend) {
    case 'qsv':
      return { encoder: 'h264_qsv', filter: getQsvScaleFilter(resolution) };
    case 'vaapi':
      return { encoder: 'h264_vaapi', filter: getVaapiScaleFilter(resolution) };
    case 'videotoolbox':
      return { encoder: 'h264_videotoolbox', filter: getVideoToolboxScaleFilter(resolution) };
    default:
      return undefined;
  }
}

/** Bind both the decoder and filter/encoder to the selected hardware context. */
export function applyGpuDeviceArguments(args: string[], agent: Agent): string[] {
  if (args.includes('h264_qsv')) {
    const result = [...args];
    const input = result.indexOf('-i');
    const vf = result.indexOf('-vf');
    if (input === -1 || vf === -1 || result[vf + 1]?.startsWith('vpp_qsv=') !== true) {
      throw new Error('Quick Sync processing requires a video input and hardware scaling filter');
    }
    if (
      agent?.deviceIndex === undefined ||
      !Number.isInteger(agent.deviceIndex) ||
      agent.deviceIndex < 0
    ) {
      throw new Error('Select an Intel Quick Sync adapter in Client Settings');
    }
    result.splice(
      input,
      0,
      '-hwaccel',
      'qsv',
      '-hwaccel_device',
      'selectedGpu',
      '-hwaccel_output_format',
      'qsv'
    );
    // Bind Quick Sync to the selected Windows DirectX adapter and require hardware.
    // FFmpeg chooses the QSV decoder appropriate to the input codec automatically.
    return [
      '-init_hw_device',
      `qsv=selectedGpu:hw,child_device=${String(agent.deviceIndex)},child_device_type=d3d11va`,
      '-filter_hw_device',
      'selectedGpu',
      ...result,
    ];
  }
  if (args.includes('h264_videotoolbox')) {
    const result = [...args];
    const input = result.indexOf('-i');
    const vf = result.indexOf('-vf');
    if (input === -1 || vf === -1 || result[vf + 1]?.startsWith('scale_vt=') !== true) {
      throw new Error('VideoToolbox processing requires a video input and hardware scaling filter');
    }
    result.splice(
      input,
      0,
      '-hwaccel',
      'videotoolbox',
      '-hwaccel_device',
      'selectedGpu',
      '-hwaccel_output_format',
      'videotoolbox_vld'
    );
    // Require the hardware encoder instead of accepting VideoToolbox's software encoder.
    result.splice(result.indexOf('h264_videotoolbox') + 1, 0, '-allow_sw', '0');
    return [
      '-init_hw_device',
      'videotoolbox=selectedGpu',
      '-filter_hw_device',
      'selectedGpu',
      ...result,
    ];
  }
  if (args.includes('h264_nvenc')) {
    const result = [...args];
    const vf = result.indexOf('-vf');
    if (
      vf === -1 ||
      result[vf + 1]?.startsWith('scale_cuda=') !== true ||
      /hwdownload|hwupload|\bcrop=|\bscale=/.test(result[vf + 1] ?? '')
    ) {
      throw new Error(
        'CUDA processing requires a hardware scaling filter without CPU frame transfers'
      );
    }
    const hwaccel = result.indexOf('-hwaccel');
    if (hwaccel !== -1) {
      result[hwaccel + 1] = 'cuda';
      result.splice(hwaccel, 0, '-hwaccel_device', 'selectedGpu');
    }
    return [
      '-init_hw_device',
      `cuda=selectedGpu:${String(agent?.deviceUuid !== undefined ? 0 : (agent?.deviceIndex ?? 0))}`,
      '-filter_hw_device',
      'selectedGpu',
      ...result,
    ];
  }
  if (!args.includes('h264_amf') && !args.includes('h264_vaapi')) {
    return args;
  }
  if (args.includes('h264_amf')) {
    return [
      '-init_hw_device',
      `d3d11va=selectedGpu:${String(agent?.deviceIndex ?? 0)}`,
      '-filter_hw_device',
      'selectedGpu',
      ...args,
    ];
  }
  if (agent?.renderDevice === undefined || !/^\/dev\/dri\/renderD\d+$/.test(agent.renderDevice)) {
    throw new Error('Select a VA-API render device in Client Settings');
  }
  // Decode into VA-API surfaces and keep them on the selected device through
  // scaling, pixel-format conversion, and encoding. No CPU upload/download path.
  const result = [...args];
  for (const option of ['-hwaccel', '-hwaccel_device', '-hwaccel_output_format']) {
    const index = result.indexOf(option);
    if (index !== -1) {
      result.splice(index, 2);
    }
  }
  const input = result.indexOf('-i');
  if (input === -1) {
    throw new Error('VA-API processing requires a video input');
  }
  result.splice(
    input,
    0,
    '-hwaccel',
    'vaapi',
    '-hwaccel_device',
    'selectedGpu',
    '-hwaccel_output_format',
    'vaapi'
  );
  const vf = result.indexOf('-vf');
  if (vf !== -1) {
    if (result[vf + 1]?.startsWith('scale_vaapi=') !== true) {
      throw new Error('VA-API processing requires a hardware scaling filter');
    }
  } else {
    result.splice(
      result.indexOf('-c:v'),
      0,
      '-vf',
      "scale_vaapi=w='max(2,trunc(iw/2)*2)':h='max(2,trunc(ih/2)*2)':format=nv12"
    );
  }
  return [
    '-init_hw_device',
    `vaapi=selectedGpu:${agent.renderDevice}`,
    '-filter_hw_device',
    'selectedGpu',
    ...result,
  ];
}

/** Exercise compressed input decoding, GPU filtering and H.264 encoding together. */
export function getGpuProbeArguments(agent: Agent, sourcePath: string): string[] {
  const hardware = getHardwareH264Options(agent, '360p');
  if (hardware !== undefined) {
    return applyGpuDeviceArguments(
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-i',
        sourcePath,
        '-vf',
        hardware.filter,
        '-c:v',
        hardware.encoder,
        '-b:v',
        '1000k',
        '-frames:v',
        '2',
        '-an',
        '-f',
        'null',
        '-',
      ],
      agent
    );
  }
  const nvidia = agent?.processingAgentName === 'NVIDIA';
  return applyGpuDeviceArguments(
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-hwaccel',
      nvidia ? 'cuda' : 'd3d11va',
      ...(nvidia ? ['-hwaccel_output_format', 'cuda'] : ['-hwaccel_device', 'selectedGpu']),
      '-i',
      sourcePath,
      '-vf',
      nvidia ? getCudaScaleFilter('360p') : 'scale=640:360,crop=640:360',
      '-c:v',
      nvidia ? 'h264_nvenc' : 'h264_amf',
      '-frames:v',
      '2',
      '-an',
      '-f',
      'null',
      '-',
    ],
    agent
  );
}
