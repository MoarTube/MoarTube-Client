import os from 'node:os';
import systeminformation from 'systeminformation';
import type { ClientSettings } from '@/config/index.js';
import { getDirectXAdapters, getNvidiaDevices } from './windows-gpus.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export function detectOperatingSystem(): NodeJS.Platform {
  return os.platform();
}

export async function detectSystemCpu(): Promise<{
  processingAgentName: string;
  processingAgentModel: string;
}> {
  const cpu = await systeminformation.cpu();
  return {
    processingAgentName: 'CPU', // Generic fallback or specific brand
    processingAgentModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
  };
}

export interface DetectedGpu {
  id: string;
  processingAgentName: 'NVIDIA' | 'AMD' | 'Intel' | 'VideoToolbox';
  processingAgentModel: string;
  // CUDA counts NVIDIA devices; DirectX counts all display adapters.
  deviceIndex: number;
  deviceUuid?: string;
  backend?: 'nvenc' | 'amf' | 'vaapi' | 'qsv' | 'videotoolbox';
  renderDevice?: string;
}

export async function detectSystemGpus(): Promise<DetectedGpu[]> {
  if (detectOperatingSystem() === 'darwin') {
    // VideoToolbox chooses the hardware through macOS; it does not support
    // selecting a physical GPU index. The FFmpeg probe establishes availability.
    return [
      {
        id: 'videotoolbox:default',
        processingAgentName: 'VideoToolbox',
        processingAgentModel: 'macOS hardware video',
        deviceIndex: 0,
        backend: 'videotoolbox',
      },
    ];
  }
  if (detectOperatingSystem() === 'win32') {
    const adapters = await getDirectXAdapters();
    const gpus: DetectedGpu[] = adapters
      .filter((adapter) => adapter.Vendor === 0x1002 || adapter.Vendor === 0x8086)
      .map((adapter) => ({
        id: `${adapter.Vendor === 0x8086 ? 'Intel' : 'AMD'}:${adapter.Id}`,
        processingAgentName: adapter.Vendor === 0x8086 ? 'Intel' : 'AMD',
        processingAgentModel: adapter.Name.replace(/^(AMD|Intel(?:\(R\))?)\s+/i, ''),
        deviceIndex: adapter.Index,
        backend: adapter.Vendor === 0x8086 ? 'qsv' : 'amf',
      }));
    if (adapters.some((adapter) => adapter.Vendor === 0x10de)) {
      const devices = await getNvidiaDevices().catch(() => []);
      for (const device of devices) {
        gpus.push({
          id: device.uuid,
          processingAgentName: 'NVIDIA',
          processingAgentModel: device.model.replace(/^NVIDIA\s+/i, ''),
          // The process exposes only this UUID through CUDA_VISIBLE_DEVICES.
          deviceIndex: 0,
          deviceUuid: device.uuid,
          backend: 'nvenc',
        });
      }
    }
    return gpus;
  }
  if (detectOperatingSystem() === 'linux') {
    // nvidia-smi works without a display server and inside NVIDIA containers.
    // Failure on one vendor must not hide devices from the other vendor.
    const devices = await getNvidiaDevices().catch(() => []);
    const gpus: DetectedGpu[] = devices.map((device) => ({
      id: device.uuid,
      processingAgentName: 'NVIDIA',
      processingAgentModel: device.model.replace(/^NVIDIA\s+/i, ''),
      deviceIndex: 0,
      deviceUuid: device.uuid,
      backend: 'nvenc',
    }));
    const nodes = await fs.readdir('/sys/class/drm').catch(() => []);
    for (const node of nodes.filter((name) => /^renderD\d+$/.test(name)).sort()) {
      try {
        const device = `/sys/class/drm/${node}/device`;
        const vendor = (await fs.readFile(`${device}/vendor`, 'utf8')).trim().toLowerCase();
        if (vendor !== '0x1002' && vendor !== '0x8086') {
          continue;
        }
        const pciAddress = path.basename(await fs.realpath(device));
        const deviceId = (await fs.readFile(`${device}/device`, 'utf8')).trim();
        gpus.push({
          id: `${vendor === '0x8086' ? 'Intel' : 'AMD'}:${pciAddress}`,
          processingAgentName: vendor === '0x8086' ? 'Intel' : 'AMD',
          processingAgentModel: `${vendor === '0x8086' ? 'Graphics' : 'Radeon'} ${deviceId} (${pciAddress})`,
          deviceIndex: Number(node.slice('renderD'.length)),
          backend: 'vaapi',
          renderDevice: `/dev/dri/${node}`,
        });
      } catch {
        // A device may disappear or its sysfs metadata may be inaccessible.
      }
    }
    return gpus;
  }
  // Other operating systems need their own supported FFmpeg backend.
  return [];
}

export function getGpuProcessEnvironment(
  agent: ClientSettings['processingAgent']
): NodeJS.ProcessEnv {
  if (
    agent?.processingAgentType === 'gpu' &&
    agent.processingAgentName === 'NVIDIA' &&
    agent.deviceUuid !== undefined
  ) {
    return { ...process.env, CUDA_VISIBLE_DEVICES: agent.deviceUuid };
  }
  return process.env;
}
