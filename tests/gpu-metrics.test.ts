import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getGpuMetrics } from '../src/utils/gpu-metrics.js';

const { run, directX, readFile, realpath, nvidiaProcesses, drmMemory } = vi.hoisted(() => ({
  run: vi.fn(),
  directX: vi.fn(),
  readFile: vi.fn(),
  realpath: vi.fn(),
  nvidiaProcesses: vi.fn(),
  drmMemory: vi.fn(),
}));
vi.mock('node:util', () => ({ promisify: (): typeof run => run }));
vi.mock('node:fs/promises', () => ({ readFile, realpath }));
vi.mock('../src/utils/windows-gpus.js', () => ({ getDirectXGpuMetrics: directX }));
vi.mock('../src/utils/gpu-process-metrics.js', () => ({
  getNvidiaProcessMetrics: nvidiaProcesses,
  getDrmProcessMemory: drmMemory,
  unavailableGpuContribution: {
    appEncodePercent: null,
    appDecodePercent: null,
    appMemoryBytes: null,
  },
}));
const unavailable = { appEncodePercent: null, appDecodePercent: null, appMemoryBytes: null };
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
if (platform === undefined) {
  throw new Error('Missing platform descriptor');
}
beforeEach(() => {
  vi.resetAllMocks();
  directX.mockRejectedValue(new Error('Counters unavailable'));
  nvidiaProcesses.mockRejectedValue(new Error('Process telemetry unavailable'));
  drmMemory.mockResolvedValue(null);
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
});

it('returns zero without querying hardware when GPU acceleration is disabled', async () => {
  const zero = {
    encodePercent: 0,
    decodePercent: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    appEncodePercent: 0,
    appDecodePercent: 0,
    appMemoryBytes: 0,
  };
  expect(await getGpuMetrics(undefined)).toEqual(zero);
  expect(await getGpuMetrics({ processingAgentType: 'cpu', deviceUuid: 'GPU-old' })).toEqual({
    ...zero,
  });
  expect(run).not.toHaveBeenCalled();
  expect(directX).not.toHaveBeenCalled();
});

it('queries the selected NVIDIA UUID instead of assuming the first GPU', async () => {
  run.mockResolvedValue({ stdout: '51, 2, 2048, 16384, 00000000:01:00.0, 1\n' });
  expect(
    await getGpuMetrics({
      processingAgentType: 'gpu',
      processingAgentName: 'NVIDIA',
      deviceUuid: 'GPU-second',
      deviceIndex: 0,
    })
  ).toEqual({
    ...unavailable,
    encodePercent: 51,
    decodePercent: 2,
    memoryUsedBytes: 2 * 1024 ** 3,
    memoryTotalBytes: 16 * 1024 ** 3,
  });
  expect(run).toHaveBeenCalledWith(
    'nvidia-smi',
    [
      '--id=GPU-second',
      '--query-gpu=utilization.encoder,utilization.decoder,memory.used,memory.total,pci.bus_id,index',
      '--format=csv,noheader,nounits',
    ],
    expect.objectContaining({ windowsHide: true })
  );
});

it('uses the current adapter identity for Windows Intel and AMD utilization', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const metrics = {
    ...unavailable,
    encodePercent: 65,
    decodePercent: 3,
    memoryUsedBytes: 1024,
    memoryTotalBytes: 8192,
  };
  directX.mockResolvedValue(metrics);
  expect(
    await getGpuMetrics({
      processingAgentType: 'gpu',
      processingAgentName: 'Intel',
      gpuId: 'Intel:pci-second',
      deviceIndex: 2,
    })
  ).toEqual(metrics);
  expect(directX).toHaveBeenCalledWith('Intel:pci-second', process.pid);
});

it('reads Linux AMD utilization only after verifying the render node identity', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  realpath.mockResolvedValue('/sys/devices/0000:03:00.0');
  readFile.mockResolvedValueOnce('1024\n').mockResolvedValueOnce('8192\n');
  const agent = {
    processingAgentType: 'gpu',
    processingAgentName: 'AMD',
    gpuId: 'AMD:0000:03:00.0',
    renderDevice: '/dev/dri/renderD129',
  };
  expect(await getGpuMetrics(agent)).toEqual({
    ...unavailable,
    encodePercent: null,
    decodePercent: null,
    memoryUsedBytes: 1024,
    memoryTotalBytes: 8192,
  });
  expect(readFile).toHaveBeenCalledWith(
    '/sys/class/drm/renderD129/device/mem_info_vram_used',
    'utf8'
  );
  readFile.mockClear();
  realpath.mockResolvedValue('/sys/devices/0000:04:00.0');
  await expect(getGpuMetrics(agent)).rejects.toThrow('identity has changed');
  expect(readFile).not.toHaveBeenCalled();
});

it.each(['N/A', '', '101', '-1'])(
  'preserves supported readings when encoder telemetry is unavailable or invalid: %s',
  async (stdout) => {
    run.mockResolvedValue({ stdout: `${stdout}, 5, 1024, 4096, 00000000:01:00.0, 1` });
    expect(
      await getGpuMetrics({
        processingAgentType: 'gpu',
        processingAgentName: 'NVIDIA',
        deviceUuid: 'GPU-selected',
      })
    ).toEqual({
      ...unavailable,
      encodePercent: null,
      decodePercent: 5,
      memoryUsedBytes: 1024 ** 3,
      memoryTotalBytes: 4 * 1024 ** 3,
    });
  }
);

it('maps the NVIDIA UUID to its PCI adapter for Windows attribution and uses the application root', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  run.mockResolvedValue({ stdout: '60, 4, 2048, 16384, 00000000:0A:02.1, 2' });
  const app = { appEncodePercent: 45, appDecodePercent: 2, appMemoryBytes: 1024 ** 3 };
  directX.mockResolvedValue({
    encodePercent: 59,
    decodePercent: 4,
    memoryUsedBytes: 2048,
    memoryTotalBytes: 16384,
    ...app,
  });
  const metrics = await getGpuMetrics(
    { processingAgentType: 'gpu', processingAgentName: 'NVIDIA', deviceUuid: 'GPU-second' },
    1234
  );
  expect(directX).toHaveBeenCalledWith('NVIDIA:10:2:1', 1234);
  expect(metrics).toMatchObject({ encodePercent: 60, decodePercent: 4, ...app });
});

it('gets Linux NVIDIA attribution for the selected device index without replacing total readings', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  run.mockResolvedValue({ stdout: '60, 4, 2048, 16384, 00000000:0A:02.1, 2' });
  const app = { appEncodePercent: 45, appDecodePercent: 2, appMemoryBytes: 1024 ** 3 };
  nvidiaProcesses.mockResolvedValue(app);
  expect(
    await getGpuMetrics(
      { processingAgentType: 'gpu', processingAgentName: 'NVIDIA', deviceUuid: 'GPU-second' },
      1234
    )
  ).toMatchObject({ encodePercent: 60, ...app });
  expect(nvidiaProcesses).toHaveBeenCalledWith(2, 1234);
});

it('reports unsupported monitoring instead of inventing a zero reading', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  await expect(
    getGpuMetrics({ processingAgentType: 'gpu', backend: 'videotoolbox' })
  ).rejects.toThrow('unavailable');
});
