import { beforeEach, expect, it, vi } from 'vitest';
import {
  getNvidiaProcessMetrics,
  parseNvidiaProcessMetrics,
  getDrmProcessMemory,
} from '../src/utils/gpu-process-metrics.js';

const { run, snapshot, readFile, readdir } = vi.hoisted(() => ({
  run: vi.fn(),
  snapshot: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock('node:util', () => ({ promisify: (): typeof run => run }));
vi.mock('node:fs/promises', () => ({ readFile, readdir }));
vi.mock('../src/utils/process-cpu.js', () => ({ getProcessCpuSnapshot: snapshot }));

beforeEach(() => {
  vi.resetAllMocks();
  snapshot.mockResolvedValue({
    helperPid: 999,
    processes: [
      { pid: 100, parentPid: 1 },
      { pid: 101, parentPid: 100 },
      { pid: 102, parentPid: 101 },
      { pid: 999, parentPid: 100 },
      { pid: 998, parentPid: 999 },
      { pid: 200, parentPid: 1 },
    ],
  });
});

it('sums NVIDIA process activity for the selected device and MoarTube process tree, including FFmpeg', async () => {
  run.mockResolvedValue({
    stdout: `# gpu pid type sm mem enc dec jpg ofa fb ccpm command
# Idx # C/G % % % % % % MB MB name
0 101 C 0 0 90 90 0 0 9999 0 ffmpeg
1 100 C 0 0 0 0 0 0 10 0 node
1 101 C 0 0 30 2 0 0 100 0 ffmpeg
1 102 C 0 0 15 3 0 0 200 0 ffmpeg child
1 200 C 0 0 40 20 0 0 800 0 other app
1 999 C 0 0 1 1 0 0 999 0 measurement helper
1 998 C 0 0 1 1 0 0 999 0 helper child
`,
  });
  expect(await getNvidiaProcessMetrics(1, 100)).toEqual({
    appEncodePercent: 45,
    appDecodePercent: 5,
    appMemoryBytes: 310 * 1024 ** 2,
  });
  expect(run).toHaveBeenCalledWith(
    'nvidia-smi',
    ['pmon', '-i', '1', '-s', 'um', '-c', '1'],
    expect.objectContaining({ windowsHide: true })
  );
});

it('handles optional NVIDIA columns independently rather than turning unavailable readings into zero', () => {
  const pids = new Set([101]);
  expect(
    parseNvidiaProcessMetrics('# gpu pid type enc dec fb command\n1 101 C - 10 250 ffmpeg', 1, pids)
  ).toEqual({ appEncodePercent: null, appDecodePercent: 10, appMemoryBytes: 250 * 1024 ** 2 });
  expect(
    parseNvidiaProcessMetrics('# gpu pid type enc dec command\n1 101 C 10 5 ffmpeg', 1, pids)
  ).toEqual({ appEncodePercent: 10, appDecodePercent: 5, appMemoryBytes: null });
  expect(() => parseNvidiaProcessMetrics('Not supported', 1, pids)).toThrow('unavailable');
  expect(() => parseNvidiaProcessMetrics('# gpu pid type enc dec fb command', 1, pids)).toThrow(
    'Missing'
  );
});

it('returns zero when a valid NVIDIA sample contains no application GPU activity', () => {
  expect(
    parseNvidiaProcessMetrics('# gpu pid type enc dec fb command\n1 - - - - - -', 1, new Set([100]))
  ).toEqual({ appEncodePercent: 0, appDecodePercent: 0, appMemoryBytes: 0 });
});

it('does not report a zero contribution when the application root is missing', async () => {
  await expect(getNvidiaProcessMetrics(1, 12345)).rejects.toThrow('Application process');
  expect(run).not.toHaveBeenCalled();
});

const info = (client: string, shared = '0', pci = '0000:03:00.0'): string => `drm-driver: amdgpu
drm-pdev: ${pci}
drm-client-id: ${client}
drm-resident-vram: 1024 KiB
drm-shared-vram: ${shared} KiB
`;

it('counts resident AMD VRAM once per DRM client across duplicated descriptors and child processes', async () => {
  readdir.mockResolvedValue(['5', '6']);
  readFile.mockImplementation((file: string) =>
    Promise.resolve(
      file.endsWith('/6') ? info('43', '0', '0000:04:00.0') : info('42')
    )
  );
  expect(await getDrmProcessMemory('0000:03:00.0', 100)).toBe(1024 ** 2);
  expect(readdir).not.toHaveBeenCalledWith('/proc/200/fdinfo');
  expect(readdir).not.toHaveBeenCalledWith('/proc/999/fdinfo');
});

it('marks shared or inaccessible DRM allocations unavailable instead of double-counting them', async () => {
  readdir.mockResolvedValue(['5']);
  readFile.mockResolvedValue(info('42', '512'));
  expect(await getDrmProcessMemory('0000:03:00.0', 100)).toBeNull();
  readdir.mockRejectedValue(new Error('Access denied'));
  expect(await getDrmProcessMemory('0000:03:00.0', 100)).toBeNull();
});
