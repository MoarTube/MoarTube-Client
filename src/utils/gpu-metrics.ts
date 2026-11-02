import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ClientSettings } from '@/config/index.js';
import { getDirectXGpuMetrics } from './windows-gpus.js';
import {
  getNvidiaProcessMetrics,
  getDrmProcessMemory,
  unavailableGpuContribution,
  type GpuContribution,
} from './gpu-process-metrics.js';

const run = promisify(execFile);

export interface GpuMetrics extends GpuContribution {
  encodePercent: number | null;
  decodePercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
}

function reading(value: string, maximum = Infinity): number | null {
  const trimmed = value.trim();
  const used = trimmed === '' ? NaN : Number(trimmed);
  return Number.isFinite(used) && used >= 0 && used <= maximum ? used : null;
}

/** Utilization of exactly the configured GPU; disabled acceleration always reports zero. */
export async function getGpuMetrics(
  agent: ClientSettings['processingAgent'],
  rootPid: number = process.pid
): Promise<GpuMetrics> {
  if (agent?.processingAgentType !== 'gpu') {
    return {
      encodePercent: 0,
      decodePercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      appEncodePercent: 0,
      appDecodePercent: 0,
      appMemoryBytes: 0,
    };
  }

  if (agent.processingAgentName === 'NVIDIA') {
    // CUDA/DirectX indices have different meanings; use the persistent UUID used by encoding.
    const uuid = agent.deviceUuid ?? agent.gpuId;
    if (uuid?.startsWith('GPU-') !== true) {
      throw new Error('Selected NVIDIA GPU identity is unavailable');
    }
    const { stdout } = await run(
      'nvidia-smi',
      [
        '--id=' + uuid,
        '--query-gpu=utilization.encoder,utilization.decoder,memory.used,memory.total,pci.bus_id,index',
        '--format=csv,noheader,nounits',
      ],
      { windowsHide: true, timeout: 10000 }
    );
    const fields = stdout.trim().split(',');
    if (fields.length !== 6) {
      throw new Error('Invalid NVIDIA metrics response');
    }
    const [encode, decode, used, total, bus, index] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const memoryUsed = reading(used);
    const memoryTotal = reading(total);
    let contribution = { ...unavailableGpuContribution };
    if (process.platform === 'win32') {
      const pci = /^0+:([\da-f]+):([\da-f]+)\.([0-7])$/i.exec(bus.trim());
      if (pci !== null) {
        const identity =
          'NVIDIA:' +
          pci
            .slice(1)
            .map((value) => parseInt(value, 16))
            .join(':');
        const windows = await getDirectXGpuMetrics(identity, rootPid).catch(() => null);
        if (windows !== null) {
          contribution = {
            appEncodePercent: windows.appEncodePercent,
            appDecodePercent: windows.appDecodePercent,
            appMemoryBytes: windows.appMemoryBytes,
          };
        }
      }
    } else if (process.platform === 'linux' && Number.isInteger(Number(index))) {
      contribution = await getNvidiaProcessMetrics(Number(index), rootPid).catch(() => ({
        ...unavailableGpuContribution,
      }));
    }
    return {
      ...contribution,
      encodePercent: reading(encode, 100),
      decodePercent: reading(decode, 100),
      memoryUsedBytes: memoryUsed === null ? null : memoryUsed * 1024 ** 2,
      memoryTotalBytes: memoryTotal === null ? null : memoryTotal * 1024 ** 2,
    };
  }

  if (process.platform === 'win32' && agent.gpuId !== undefined && agent.gpuId !== '') {
    return await getDirectXGpuMetrics(agent.gpuId, rootPid);
  }

  if (
    process.platform === 'linux' &&
    agent.processingAgentName === 'AMD' &&
    agent.renderDevice !== undefined
  ) {
    const node = path.basename(agent.renderDevice);
    if (!/^renderD\d+$/.test(node)) {
      throw new Error('Invalid selected GPU device');
    }
    const device = `/sys/class/drm/${node}/device`;
    const identity = 'AMD:' + path.basename(await realpath(device));
    if (identity !== agent.gpuId) {
      throw new Error('Selected GPU identity has changed');
    }
    const [used, total] = await Promise.all([
      readFile(`${device}/mem_info_vram_used`, 'utf8').catch(() => ''),
      readFile(`${device}/mem_info_vram_total`, 'utf8').catch(() => ''),
    ]);
    const appMemoryBytes = await getDrmProcessMemory(
      path.basename(await realpath(device)),
      rootPid
    ).catch(() => null);
    return {
      ...unavailableGpuContribution,
      appMemoryBytes,
      encodePercent: null,
      decodePercent: null,
      memoryUsedBytes: reading(used),
      memoryTotalBytes: reading(total),
    };
  }

  throw new Error('GPU utilization is unavailable for the selected device');
}
