import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config/index.js';
import type { Logger } from '../src/utils/logger.js';

const { run, detect } = vi.hoisted(() => ({ run: vi.fn(), detect: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: run }),
}));
vi.mock('../src/utils/hardware.js', async (original) => ({
  ...(await original<typeof import('../src/utils/hardware.js')>()),
  detectSystemGpus: detect,
}));
import { FfmpegService } from '../src/services/ffmpeg.js';

const nvidia = {
  id: 'GPU-123',
  processingAgentName: 'NVIDIA',
  processingAgentModel: 'Test NVIDIA',
  deviceIndex: 0,
  deviceUuid: 'GPU-123',
  backend: 'nvenc',
};
const amd = {
  id: 'AMD:0000:01:00.0',
  processingAgentName: 'AMD',
  processingAgentModel: 'Test AMD',
  deviceIndex: 128,
  renderDevice: '/dev/dri/renderD128',
  backend: 'vaapi',
};
const mac = {
  id: 'videotoolbox:default',
  processingAgentName: 'VideoToolbox',
  processingAgentModel: 'macOS hardware video',
  deviceIndex: 0,
  backend: 'videotoolbox',
};

function service(): { ffmpeg: FfmpegService; config: Config } {
  const config = { clientSettings: { ffmpegPath: '/custom/ffmpeg' } } as unknown as Config;
  const logger = { warn: vi.fn() } as unknown as Logger;
  return { ffmpeg: new FfmpegService(logger, config), config };
}

beforeEach(() => {
  vi.clearAllMocks();
  detect.mockResolvedValue([nvidia, amd]);
  run.mockResolvedValue({ stdout: '', stderr: '' });
});

describe('FFmpeg hardware capability assessment', () => {
  it.each([
    [
      'qsv',
      { deviceIndex: 3 },
      'qsv=selectedGpu:hw,child_device=3,child_device_type=d3d11va',
      'vpp_qsv=',
    ],
    [
      'vaapi',
      { deviceIndex: 130, renderDevice: '/dev/dri/renderD130' },
      'vaapi=selectedGpu:/dev/dri/renderD130',
      'scale_vaapi=',
    ],
  ])(
    'probes Intel %s decoding, scaling and encoding on the selected device',
    async (backend, device, initialization, filter) => {
      const intel = {
        id: 'Intel:test',
        processingAgentName: 'Intel',
        processingAgentModel: 'Test Intel',
        backend,
        ...device,
      };
      detect.mockResolvedValue([intel]);
      expect(await service().ffmpeg.assessGpus()).toEqual([{ ...intel, available: true }]);
      const args = run.mock.calls[0]?.[1] as string[];
      expect(args).toContain(initialization);
      expect(args).toContain(`h264_${backend}`);
      expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe(backend);
      expect(args[args.indexOf('-vf') + 1]).toMatch(new RegExp(`^${filter}`));
    }
  );

  it('disables a failed Intel Quick Sync device while continuing to probe other GPUs', async () => {
    detect.mockResolvedValue([
      { ...nvidia, id: 'Intel:test', processingAgentName: 'Intel', backend: 'qsv' },
      nvidia,
    ]);
    run.mockRejectedValueOnce(new Error('Error creating a MFX session'));
    const results = await service().ffmpeg.assessGpus();
    expect(results[0]).toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining('vpp_qsv'),
    });
    expect(results[1]).toMatchObject({ available: true });
  });
  it('checks VideoToolbox decoding, scale_vt filtering and hardware encoding before offering macOS acceleration', async () => {
    detect.mockResolvedValue([mac]);
    expect(await service().ffmpeg.assessGpus()).toEqual([{ ...mac, available: true }]);
    expect(run).toHaveBeenCalledWith(
      '/custom/ffmpeg',
      expect.arrayContaining([
        'videotoolbox=selectedGpu',
        'videotoolbox_vld',
        'h264_videotoolbox',
        '-allow_sw',
        '0',
      ]),
      expect.objectContaining({ timeout: 15000 })
    );
    const args = run.mock.calls[0]?.[1] as string[];
    expect(args[args.indexOf('-vf') + 1]).toMatch(/^scale_vt=/);
  });

  it('keeps macOS acceleration unavailable when the configured build lacks scale_vt', async () => {
    detect.mockResolvedValue([mac]);
    run.mockRejectedValueOnce(new Error("No such filter: 'scale_vt'"));
    expect(await service().ffmpeg.assessGpus()).toEqual([
      expect.objectContaining({
        available: false,
        unavailableReason: expect.stringContaining('scale_vt'),
      }),
    ]);
  });
  it('tests the configured executable and actual hardware filters/encoder with bounded execution', async () => {
    const { ffmpeg } = service();
    expect((await ffmpeg.assessGpus()).map((gpu) => gpu.available)).toEqual([true, true]);
    expect(run).toHaveBeenCalledWith(
      '/custom/ffmpeg',
      expect.arrayContaining(['h264_nvenc', '-frames:v', '2', 'null']),
      expect.objectContaining({
        timeout: 15000,
        env: expect.objectContaining({ CUDA_VISIBLE_DEVICES: 'GPU-123' }),
      })
    );
    expect(run).toHaveBeenCalledWith(
      '/custom/ffmpeg',
      expect.arrayContaining([
        'vaapi=selectedGpu:/dev/dri/renderD128',
        '-hwaccel_output_format',
        'vaapi',
        'h264_vaapi',
      ]),
      expect.objectContaining({ timeout: 15000 })
    );
  });

  it('rejects a GPU whose decoder or hardware scaler fails even if its encoder exists', async () => {
    run.mockResolvedValueOnce({ stdout: '', stderr: '' });
    run.mockRejectedValueOnce(
      new Error('Failed setup for format vaapi: hwaccel initialisation returned error')
    );
    const results = await service().ffmpeg.assessGpus();
    expect(results[0]).toMatchObject({ available: true });
    expect(results[1]).toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining('decode'),
    });
  });

  it('does not offer an unusable GPU and continues probing the other vendor', async () => {
    run.mockRejectedValueOnce(new Error('Driver does not support the required nvenc API version'));
    const results = await service().ffmpeg.assessGpus();
    expect(results[0]).toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining('FFmpeg'),
    });
    expect(results[1]).toMatchObject({ available: true });
  });

  it('caches page reads, refreshes selection checks, and invalidates on executable changes', async () => {
    const { ffmpeg, config } = service();
    await Promise.all([ffmpeg.assessGpus(), ffmpeg.assessGpus()]);
    expect(detect).toHaveBeenCalledTimes(1);
    await ffmpeg.assessGpus(true);
    expect(detect).toHaveBeenCalledTimes(2);
    config.clientSettings.ffmpegPath = '/different/ffmpeg';
    await ffmpeg.assessGpus();
    expect(detect).toHaveBeenCalledTimes(3);
  });

  it('does not spawn FFmpeg when no GPU is detected', async () => {
    detect.mockResolvedValue([]);
    expect(await service().ffmpeg.assessGpus()).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
