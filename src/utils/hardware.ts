import os from 'node:os';
import systeminformation from 'systeminformation';

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

export async function detectSystemGpu(): Promise<{
  processingAgentName: string;
  processingAgentModel: string;
}> {
  const graphics = await systeminformation.graphics();
  let processingAgentName = '';
  let processingAgentModel = '';

  for (const controller of graphics.controllers) {
    const vendor = controller.vendor.toLowerCase();

    if (vendor.includes('nvidia')) {
      processingAgentName = 'NVIDIA';
      processingAgentModel = controller.model.replace(/^.*\bNVIDIA\s*/, '');
      break;
    } else if (vendor.includes('amd') || vendor.includes('advanced micro devices')) {
      processingAgentName = 'AMD';
      processingAgentModel = controller.model.replace(/^.*\bAMD\s*/, '');
      break;
    } else {
      processingAgentName = 'none';
      processingAgentModel = 'none';
      break;
    }
  }

  return {
    processingAgentName,
    processingAgentModel,
  };
}
