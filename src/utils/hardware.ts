import os from 'node:os';
import systeminformation from 'systeminformation';

export function detectOperatingSystem(): Promise<NodeJS.Platform> {
    return Promise.resolve(os.platform());
}

export async function detectSystemCpu(): Promise<{ processingAgentName: string; processingAgentModel: string }> {
    const cpu = await systeminformation.cpu();
    return {
        processingAgentName: 'CPU', // Generic fallback or specific brand
        processingAgentModel: `${cpu.manufacturer} ${cpu.brand}`.trim()
    };
}

export async function detectSystemGpu(): Promise<{ processingAgentName: string; processingAgentModel: string }> {
    const graphics = await systeminformation.graphics();
    let processingAgentName = '';
    let processingAgentModel = '';

    // Simple heuristic to pick the first NVIDIA card found, or fallback to first controller
    // This matches the logic seen in legacy helpers.js
    for (const controller of graphics.controllers) {
        if (controller.vendor.toLowerCase().includes('nvidia')) {
            processingAgentName = 'NVIDIA';
            processingAgentModel = controller.model.replace(/^.*\bNVIDIA\s*/, '');
            break;
        }
    }

    if (!processingAgentName && graphics.controllers.length > 0) {
        const controller = graphics.controllers[0];
        if (controller) {
            processingAgentName = controller.vendor;
            processingAgentModel = controller.model;
        }
    }

    return {
        processingAgentName,
        processingAgentModel
    };
}
