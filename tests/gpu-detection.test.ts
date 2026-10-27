import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs/promises';
const { nvidia, directX } = vi.hoisted(() => ({ nvidia: vi.fn(), directX: vi.fn() }));
vi.mock('../src/utils/windows-gpus.js', () => ({
  getNvidiaDevices: nvidia,
  getDirectXAdapters: directX,
}));
import { detectSystemGpus } from '../src/utils/hardware.js';

beforeEach(() => {
  vi.restoreAllMocks();
  nvidia.mockReset().mockResolvedValue([{ uuid: 'GPU-123', model: 'NVIDIA Example' }]);
  directX.mockReset().mockResolvedValue([]);
});

describe('GPU discovery', () => {
  it('finds NVIDIA, AMD and Intel on headless Linux with independent device identities', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    vi.spyOn(fs, 'readdir').mockResolvedValue([
      'card0',
      'renderD128',
      'renderD129',
      'renderD130',
    ] as never);
    vi.spyOn(fs, 'readFile').mockImplementation((file) => {
      const name = String(file);
      return Promise.resolve(
        name.endsWith('/vendor')
          ? name.includes('renderD128')
            ? '0x1002\n'
            : name.includes('renderD129')
              ? '0x8086\n'
              : '0x1414\n'
          : '0x744c\n'
      );
    });
    vi.spyOn(fs, 'realpath').mockImplementation((file) =>
      Promise.resolve(
        String(file).includes('renderD128')
          ? '/sys/devices/pci0000:00/0000:03:00.0'
          : '/sys/devices/pci0000:00/0000:00:02.0'
      )
    );
    expect(await detectSystemGpus()).toEqual([
      expect.objectContaining({ id: 'GPU-123', backend: 'nvenc', deviceUuid: 'GPU-123' }),
      expect.objectContaining({
        id: 'AMD:0000:03:00.0',
        backend: 'vaapi',
        renderDevice: '/dev/dri/renderD128',
      }),
      expect.objectContaining({
        id: 'Intel:0000:00:02.0',
        processingAgentName: 'Intel',
        backend: 'vaapi',
        renderDevice: '/dev/dri/renderD129',
      }),
    ]);
    expect(directX).not.toHaveBeenCalled();
  });

  it('keeps multiple Windows Intel adapters selectable by their DirectX index and stable identity', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    directX.mockResolvedValue([
      { Vendor: 0x1414, Id: 'software', Index: 0, Name: 'Microsoft Basic Render Driver' },
      { Vendor: 0x8086, Id: 'pci-arc', Index: 1, Name: 'Intel(R) Arc A750' },
      { Vendor: 0x1002, Id: 'pci-amd', Index: 2, Name: 'AMD Radeon' },
      { Vendor: 0x8086, Id: 'pci-uhd', Index: 3, Name: 'Intel UHD Graphics' },
    ]);
    expect(await detectSystemGpus()).toEqual([
      expect.objectContaining({
        id: 'Intel:pci-arc',
        processingAgentName: 'Intel',
        processingAgentModel: 'Arc A750',
        backend: 'qsv',
        deviceIndex: 1,
      }),
      expect.objectContaining({ id: 'AMD:pci-amd', backend: 'amf', deviceIndex: 2 }),
      expect.objectContaining({
        id: 'Intel:pci-uhd',
        processingAgentName: 'Intel',
        backend: 'qsv',
        deviceIndex: 3,
      }),
    ]);
  });

  it('keeps Linux Intel discovery working when nvidia-smi is unavailable', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    nvidia.mockRejectedValue(new Error('ENOENT'));
    vi.spyOn(fs, 'readdir').mockResolvedValue(['renderD129'] as never);
    vi.spyOn(fs, 'readFile').mockImplementation((file) =>
      Promise.resolve(String(file).endsWith('/vendor') ? '0x8086\n' : '0x56a1\n')
    );
    vi.spyOn(fs, 'realpath').mockResolvedValue('/sys/devices/pci0000:00/0000:04:00.0');
    expect(await detectSystemGpus()).toEqual([
      expect.objectContaining({
        id: 'Intel:0000:04:00.0',
        backend: 'vaapi',
        renderDevice: '/dev/dri/renderD129',
      }),
    ]);
  });

  it('keeps Linux NVIDIA discovery working when DRM/sysfs is absent', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('ENOENT'));
    expect(await detectSystemGpus()).toEqual([expect.objectContaining({ id: 'GPU-123' })]);
  });

  it('returns no devices on unsupported operating systems', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('freebsd');
    expect(await detectSystemGpus()).toEqual([]);
    expect(nvidia).not.toHaveBeenCalled();
  });

  it.each(['arm64', 'x64'] as const)(
    'offers the macOS-managed VideoToolbox backend on %s',
    async (architecture) => {
      vi.spyOn(os, 'platform').mockReturnValue('darwin');
      vi.spyOn(os, 'arch').mockReturnValue(architecture);
      expect(await detectSystemGpus()).toEqual([
        {
          id: 'videotoolbox:default',
          processingAgentName: 'VideoToolbox',
          processingAgentModel: 'macOS hardware video',
          deviceIndex: 0,
          backend: 'videotoolbox',
        },
      ]);
      expect(nvidia).not.toHaveBeenCalled();
      expect(directX).not.toHaveBeenCalled();
    }
  );

  it('keeps Windows AMD discovery working if nvidia-smi fails', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    nvidia.mockRejectedValue(new Error('ENOENT'));
    directX.mockResolvedValue([
      { Vendor: 0x1002, Id: 'pci-amd', Index: 2, Name: 'AMD Radeon' },
      { Vendor: 0x10de, Id: 'pci-nvidia', Index: 1, Name: 'NVIDIA Example' },
    ]);
    expect(await detectSystemGpus()).toEqual([
      expect.objectContaining({ id: 'AMD:pci-amd', backend: 'amf', deviceIndex: 2 }),
    ]);
  });
});
