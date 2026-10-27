import { describe, expect, it } from 'vitest';
import {
  applyGpuDeviceArguments,
  getVaapiScaleFilter,
  getGpuProbeArguments,
  getVideoToolboxScaleFilter,
  getQsvScaleFilter,
  getCudaScaleFilter,
} from '../src/utils/gpu-encoding.js';
import { getGpuProcessEnvironment } from '../src/utils/hardware.js';
import { DEFAULT_CLIENT_SETTINGS } from '../src/config/defaults.js';
import type { ClientSettings } from '../src/config/index.js';
import { VideoPublishService } from '../src/services/video-publish.js';
import { LiveStreamService } from '../src/services/live-stream.js';

const amd: NonNullable<ClientSettings['processingAgent']> = {
  processingAgentType: 'gpu',
  processingAgentName: 'AMD',
  backend: 'vaapi',
  renderDevice: '/dev/dri/renderD129',
  deviceIndex: 129,
};
const nvidia: NonNullable<ClientSettings['processingAgent']> = {
  processingAgentType: 'gpu',
  processingAgentName: 'NVIDIA',
  backend: 'nvenc',
  deviceUuid: 'GPU-second-device',
  deviceIndex: 0,
};
const mac: NonNullable<ClientSettings['processingAgent']> = {
  processingAgentType: 'gpu',
  processingAgentName: 'VideoToolbox',
  backend: 'videotoolbox',
  gpuId: 'videotoolbox:default',
  deviceIndex: 0,
};

const intelWindows: NonNullable<ClientSettings['processingAgent']> = {
  processingAgentType: 'gpu',
  processingAgentName: 'Intel',
  backend: 'qsv',
  deviceIndex: 3,
};
const intelLinux: NonNullable<ClientSettings['processingAgent']> = {
  processingAgentType: 'gpu',
  processingAgentName: 'Intel',
  backend: 'vaapi',
  renderDevice: '/dev/dri/renderD130',
  deviceIndex: 130,
};

function publish(
  agent: ClientSettings['processingAgent'],
  format: string,
  resolution = '720p',
  extension = '.mp4'
): string[] {
  const settings = { ...DEFAULT_CLIENT_SETTINGS, processingAgent: agent };
  const context = {
    settingsRepository: {
      getClientSettings: () => settings,
      getVideosDirectoryPath: () => '/videos',
    },
  } as unknown as VideoPublishService;
  return VideoPublishService.prototype['generateFfmpegVideoArguments'].call(
    context,
    'video',
    resolution,
    format,
    '/source.mp4',
    '/output',
    extension,
    'https://node.example'
  );
}

function live(agent: ClientSettings['processingAgent'], resolution = '720p'): string[] {
  const context = {
    settingsRepository: {
      getClientSettings: () => ({ ...DEFAULT_CLIENT_SETTINGS, processingAgent: agent }),
    },
  } as unknown as LiveStreamService;
  return LiveStreamService.prototype['generateFfmpegLiveArguments'].call(
    context,
    'video',
    resolution,
    'm3u8',
    'rtmp://0.0.0.0:1935/live/test',
    false,
    'https://node.example'
  );
}

describe('hardware processing arguments', () => {
  it.each(['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'])(
    'keeps NVIDIA publishing, live streaming and scaling in GPU memory at %s',
    (resolution) => {
      for (const args of [
        publish(nvidia, 'mp4', resolution),
        publish(nvidia, 'm3u8', resolution),
        live(nvidia, resolution),
      ]) {
        expect(args[args.indexOf('-vf') + 1]).toBe(getCudaScaleFilter(resolution));
        expect(args.join(' ')).not.toMatch(/hwdownload|hwupload|\bcrop=|\bscale=/);
        expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe('cuda');
        expect(args.indexOf('-hwaccel_output_format')).toBeLessThan(args.indexOf('-i'));
        expect(args).toContain('h264_nvenc');
      }
    }
  );

  it.each(['mp4', 'm3u8'])(
    'retains explicit H.264 decoding for NVIDIA %s transport-stream publishing',
    (format) => {
      const args = publish(nvidia, format, '360p', '.ts');
      expect(args.slice(0, args.indexOf('-i'))).toContain('h264_cuvid');
      expect(args[args.indexOf('-vf') + 1]).toBe(getCudaScaleFilter('360p'));
    }
  );

  it('probes NVIDIA with the same hardware-only filter used by publishing and live streams', () => {
    const args = getGpuProbeArguments(nvidia, '/probe.h264');
    expect(args[args.indexOf('-vf') + 1]).toBe(getCudaScaleFilter('360p'));
    expect(args.join(' ')).not.toMatch(/hwdownload|hwupload|\bcrop=/);
    const stream = live(nvidia);
    expect(stream).toContain('-listen');
    expect(stream).toContain('-timeout');
    expect(stream.at(-1)).toBe('pipe:1');
    expect(stream).not.toContain('-hls_playlist_type');
  });

  it('rejects NVIDIA software filtering and GPU-to-CPU round trips', () => {
    for (const filter of [
      'scale=640:360',
      'scale_cuda=640:360,hwdownload,format=nv12,crop=640:360,hwupload_cuda',
    ]) {
      expect(() =>
        applyGpuDeviceArguments(
          ['-hwaccel', 'cuda', '-i', '/source', '-vf', filter, '-c:v', 'h264_nvenc', '/output'],
          nvidia
        )
      ).toThrow('hardware scaling filter');
    }
  });
  it.each(['mp4', 'm3u8'])(
    'uses selected Intel Quick Sync hardware for %s publishing',
    (format) => {
      const args = publish(intelWindows, format);
      expect(args).toContain('qsv=selectedGpu:hw,child_device=3,child_device_type=d3d11va');
      expect(args[args.indexOf('-hwaccel') + 1]).toBe('qsv');
      expect(args[args.indexOf('-hwaccel_device') + 1]).toBe('selectedGpu');
      expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe('qsv');
      expect(args.indexOf('-hwaccel_output_format')).toBeLessThan(args.indexOf('-i'));
      expect(args[args.indexOf('-vf') + 1]).toBe(getQsvScaleFilter('720p'));
      expect(args[args.indexOf('-vf') + 1]).not.toMatch(/hwupload|hwdownload|\bcrop=|\bscale=/);
      expect(args[args.indexOf('-c:v') + 1]).toBe('h264_qsv');
      expect(args).not.toContain('h264_amf');
      // Input codec selection stays automatic for HEVC/VP9 rather than pinning H.264.
      expect(args.slice(0, args.indexOf('-i'))).not.toContain('-c:v');
      expect(args.at(-1)).toBe('/output');
    }
  );

  it.each(['mp4', 'm3u8'])(
    'uses the selected Intel VA-API render node for %s publishing',
    (format) => {
      const args = publish(intelLinux, format);
      expect(args).toContain('vaapi=selectedGpu:/dev/dri/renderD130');
      expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe('vaapi');
      expect(args[args.indexOf('-vf') + 1]).toBe(getVaapiScaleFilter('720p'));
      expect(args[args.indexOf('-c:v') + 1]).toBe('h264_vaapi');
      expect(args).not.toContain('h264_amf');
    }
  );

  it.each([intelWindows, intelLinux])(
    'keeps Intel $backend live decoding, scaling and encoding in hardware',
    (agent) => {
      const args = live(agent);
      const qsv = agent.backend === 'qsv';
      expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe(qsv ? 'qsv' : 'vaapi');
      expect(args[args.indexOf('-vf') + 1]).toBe(
        qsv ? getQsvScaleFilter('720p') : getVaapiScaleFilter('720p')
      );
      expect(args[args.indexOf('-c:v') + 1]).toBe(qsv ? 'h264_qsv' : 'h264_vaapi');
      expect(args).toContain('-listen');
      expect(args).toContain('-timeout');
      expect(args).toContain('rtmp://0.0.0.0:1935/live/test');
      expect(args).not.toContain('-hls_playlist_type');
      expect(args.at(-1)).toBe('pipe:1');
    }
  );

  it('tests the complete selected Quick Sync pipeline in the capability probe', () => {
    const args = getGpuProbeArguments(intelWindows, '/probe.h264');
    expect(args).toContain('qsv=selectedGpu:hw,child_device=3,child_device_type=d3d11va');
    expect(args[args.indexOf('-vf') + 1]).toBe(getQsvScaleFilter('360p'));
    expect(args).toContain('h264_qsv');
    expect(args).toContain('/probe.h264');
    expect(args).not.toContain('lavfi');
  });

  it('rejects software scaling or an invalid Quick Sync adapter', () => {
    expect(() =>
      applyGpuDeviceArguments(
        ['-i', '/source', '-vf', 'scale=640:360', '-c:v', 'h264_qsv', '/output'],
        intelWindows
      )
    ).toThrow('hardware scaling filter');
    expect(() => publish({ ...intelWindows, deviceIndex: -1 }, 'mp4')).toThrow(
      'Quick Sync adapter'
    );
  });
  it.each(['m3u8', 'mp4'])(
    'uses VideoToolbox decoding, scaling and hardware encoding for %s publishing',
    (format) => {
      const args = publish(mac, format);
      expect(args).toContain('videotoolbox=selectedGpu');
      expect(args[args.indexOf('-hwaccel') + 1]).toBe('videotoolbox');
      expect(args[args.indexOf('-hwaccel_device') + 1]).toBe('selectedGpu');
      expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe('videotoolbox_vld');
      expect(args.indexOf('-hwaccel_output_format')).toBeLessThan(args.indexOf('-i'));
      expect(args[args.indexOf('-vf') + 1]).toBe(getVideoToolboxScaleFilter('720p'));
      expect(args[args.indexOf('-vf') + 1]).not.toMatch(/hwdownload|hwupload|\bcrop=|\bscale=/);
      expect(args[args.indexOf('-c:v') + 1]).toBe('h264_videotoolbox');
      expect(args[args.indexOf('-allow_sw') + 1]).toBe('0');
      expect(args).not.toContain('libx264');
      expect(args).not.toContain('h264_amf');
      expect(args.at(-1)).toBe('/output');
    }
  );

  it('uses VideoToolbox for realtime HLS streams while retaining the RTMP listener', () => {
    const args = live(mac);
    expect(args).toContain('videotoolbox=selectedGpu');
    expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe('videotoolbox_vld');
    expect(args[args.indexOf('-vf') + 1]).toBe(getVideoToolboxScaleFilter('720p'));
    expect(args[args.indexOf('-realtime') + 1]).toBe('1');
    expect(args[args.indexOf('-allow_sw') + 1]).toBe('0');
    expect(args).toContain('-listen');
    expect(args).toContain('rtmp://0.0.0.0:1935/live/test');
    expect(args).not.toContain('-hls_playlist_type');
    expect(args.at(-1)).toBe('pipe:1');
  });

  it('uses a compressed-input VideoToolbox probe with hardware-only encoder selection', () => {
    const args = getGpuProbeArguments(mac, '/probe.h264');
    expect(args).toContain('/probe.h264');
    expect(args).toContain('videotoolbox_vld');
    expect(args[args.indexOf('-c:v') + 1]).toBe('h264_videotoolbox');
    expect(args[args.indexOf('-allow_sw') + 1]).toBe('0');
    expect(args[args.indexOf('-vf') + 1]).toBe(getVideoToolboxScaleFilter('360p'));
  });

  it('rejects a software scaling graph for VideoToolbox', () => {
    expect(() =>
      applyGpuDeviceArguments(
        ['-i', '/source.mp4', '-vf', 'scale=640:360', '-c:v', 'h264_videotoolbox', '/output.mp4'],
        mac
      )
    ).toThrow('hardware scaling filter');
  });
  it.each(['m3u8', 'mp4'])('uses the selected AMD render node for %s publishing', (format) => {
    const args = publish(amd, format);
    expect(args).toContain('vaapi=selectedGpu:/dev/dri/renderD129');
    expect(args).toContain('h264_vaapi');
    expect(args[args.indexOf('-vf') + 1]).toBe(getVaapiScaleFilter('720p'));
    expect(args[args.indexOf('-vf') + 1]).not.toMatch(/hwupload|hwdownload|\bcrop=|\bscale=/);
    expect(args).not.toContain('d3d11va');
    expect(args).not.toContain('h264_amf');
    expect(args[args.indexOf('-hwaccel') + 1]).toBe('vaapi');
    expect(args[args.indexOf('-hwaccel_device') + 1]).toBe('selectedGpu');
    expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe('vaapi');
    expect(args.indexOf('-hwaccel_output_format')).toBeLessThan(args.indexOf('-i'));
    expect(args.at(-1)).toBe('/output');
  });

  it('decodes and scales live frames on the selected AMD GPU and retains RTMP/HLS options', () => {
    const args = live(amd);
    expect(args).toContain('vaapi=selectedGpu:/dev/dri/renderD129');
    expect(args[args.indexOf('-vf') + 1]).toBe(getVaapiScaleFilter('720p'));
    expect(args[args.indexOf('-hwaccel') + 1]).toBe('vaapi');
    expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe('vaapi');
    expect(args.indexOf('-hwaccel_output_format')).toBeLessThan(args.indexOf('-i'));
    expect(args).toContain('h264_vaapi');
    expect(args).toContain('rtmp://0.0.0.0:1935/live/test');
    expect(args).toContain('-listen');
    expect(args).not.toContain('-hls_playlist_type');
    expect(args.at(-1)).toBe('pipe:1');
  });

  it.each(['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'])(
    'uses a hardware-only scaling filter for %s',
    (resolution) => {
      const args = publish(amd, 'mp4', resolution);
      const filter = args[args.indexOf('-vf') + 1];
      expect(filter).toBe(getVaapiScaleFilter(resolution));
      expect(filter).toMatch(/^scale_vaapi=.*format=nv12$/);
      expect(filter).not.toMatch(/hwdownload|hwupload|\bcrop=/);
    }
  );

  it('checks compressed-input VA-API decoding, GPU scaling and encoding together', () => {
    const args = getGpuProbeArguments(amd, '/probe.h264');
    expect(args).toContain('/probe.h264');
    expect(args).not.toContain('lavfi');
    expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe('vaapi');
    expect(args[args.indexOf('-vf') + 1]).toBe(getVaapiScaleFilter('360p'));
    expect(args).toContain('h264_vaapi');
  });

  it('rejects a software filter instead of silently using CPU frames', () => {
    expect(() =>
      applyGpuDeviceArguments(
        ['-i', '/source.mp4', '-vf', 'scale=640:360', '-c:v', 'h264_vaapi', '/output.mp4'],
        amd
      )
    ).toThrow('hardware scaling filter');
  });

  it('preserves Windows AMD device selection', () => {
    const args = publish({ ...amd, backend: 'amf', deviceIndex: 2 }, 'mp4');
    expect(args).toContain('d3d11va=selectedGpu:2');
    expect(args).toContain('h264_amf');
    expect(args).not.toContain('h264_vaapi');
  });

  it('binds NVIDIA decoder and filters to the UUID-isolated device', () => {
    for (const args of [publish(nvidia, 'mp4'), live(nvidia)]) {
      expect(args).toContain('cuda=selectedGpu:0');
      expect(args[args.indexOf('-hwaccel') + 1]).toBe('cuda');
      expect(args[args.indexOf('-hwaccel_device') + 1]).toBe('selectedGpu');
      expect(args[args.indexOf('-filter_hw_device') + 1]).toBe('selectedGpu');
      expect(args).toContain('h264_nvenc');
    }
    expect(getGpuProcessEnvironment(nvidia)['CUDA_VISIBLE_DEVICES']).toBe('GPU-second-device');
  });

  it.each(['webm', 'ogv'])('keeps %s software encoding for either GPU vendor', (format) => {
    for (const agent of [amd, nvidia, mac, intelWindows, intelLinux]) {
      const args = publish(agent, format);
      expect(args).not.toContain('-init_hw_device');
      expect(args).not.toContain('-allow_sw');
      expect(args[args.indexOf('-vf') + 1]).not.toMatch(/cuda|hwupload/);
      expect(args).toContain(format === 'webm' ? 'libvpx-vp9' : 'libvpx');
    }
  });

  it('keeps CPU encoding available', () => {
    const args = publish({ processingAgentType: 'cpu' }, 'mp4');
    expect(args).toContain('libx264');
    expect(args).not.toContain('-init_hw_device');
  });

  it('rejects an invalid or missing VA-API device', () => {
    expect(() =>
      applyGpuDeviceArguments(['-c:v', 'h264_vaapi'], {
        ...amd,
        renderDevice: '/wrong/device',
      })
    ).toThrow('render device');
  });
});
