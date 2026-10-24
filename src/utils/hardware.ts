import os from 'node:os';
import systeminformation from 'systeminformation';
import type { ClientSettings } from '@/config/index.js';
import { getDirectXAdapters, getNvidiaDevices } from './windows-gpus.js';

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
  processingAgentName: 'NVIDIA' | 'AMD';
  processingAgentModel: string;
  // CUDA counts NVIDIA devices; DirectX counts all display adapters.
  deviceIndex: number;
  deviceUuid?: string;
}

export async function detectSystemGpus(): Promise<DetectedGpu[]> {
  if (detectOperatingSystem() === 'win32') {
    const adapters = await getDirectXAdapters();
    const gpus: DetectedGpu[] = adapters
      .filter((adapter) => adapter.Vendor === 0x1002)
      .map((adapter) => ({
        id: `AMD:${adapter.Id}`,
        processingAgentName: 'AMD',
        processingAgentModel: adapter.Name.replace(/^AMD\s+/i, ''),
        deviceIndex: adapter.Index,
      }));
    if (adapters.some((adapter) => adapter.Vendor === 0x10de)) {
      const devices = await getNvidiaDevices();
      for (const device of devices) {
        gpus.push({
          id: device.uuid,
          processingAgentName: 'NVIDIA',
          processingAgentModel: device.model.replace(/^NVIDIA\s+/i, ''),
          // The process exposes only this UUID through CUDA_VISIBLE_DEVICES.
          deviceIndex: 0,
          deviceUuid: device.uuid,
        });
      }
    }
    return gpus;
  }
  const { controllers } = await systeminformation.graphics();
  let nvidiaIndex = 0;
  return controllers.flatMap((controller, adapterIndex) => {
    const vendor = controller.vendor.toLowerCase();
    const vendorId = controller.vendorId?.toLowerCase().replace(/^0x/, '');
    const name =
      vendor.includes('nvidia') || vendorId === '10de'
        ? 'NVIDIA'
        : vendor.includes('amd') || vendor.includes('advanced micro devices') || vendorId === '1002'
          ? 'AMD'
          : undefined;
    if (!name) {
      return [];
    }
    const location =
      controller.busAddress?.trim() !== ''
        ? (controller.busAddress ?? controller.pciBus)
        : controller.pciBus;
    return [
      {
        id: `${name}:${location ?? `${controller.model}:${String(adapterIndex)}`}`,
        processingAgentName: name,
        processingAgentModel: controller.model.replace(/^(NVIDIA|AMD)\s+/i, ''),
        deviceIndex: name === 'NVIDIA' ? nvidiaIndex++ : adapterIndex,
      },
    ];
  });
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
