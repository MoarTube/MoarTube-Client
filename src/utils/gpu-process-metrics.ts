import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { getProcessCpuSnapshot } from './process-cpu.js';

const run = promisify(execFile);

export interface GpuContribution {
  appEncodePercent: number | null;
  appDecodePercent: number | null;
  appMemoryBytes: number | null;
}

export const unavailableGpuContribution: GpuContribution = {
  appEncodePercent: null,
  appDecodePercent: null,
  appMemoryBytes: null,
};

async function applicationPids(rootPid: number): Promise<Set<number>> {
  const snapshot = await getProcessCpuSnapshot();
  if (!snapshot.processes.some((entry) => entry.pid === rootPid)) {
    throw new Error('Application process is unavailable');
  }
  const children = new Map<number, number[]>();
  for (const entry of snapshot.processes) {
    const siblings = children.get(entry.parentPid) ?? [];
    siblings.push(entry.pid);
    children.set(entry.parentPid, siblings);
  }
  const result = new Set<number>();
  const pending = [rootPid];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || current === snapshot.helperPid || result.has(current)) {
      continue;
    }
    result.add(current);
    pending.push(...(children.get(current) ?? []));
  }
  return result;
}

/** Parse named columns because NVIDIA adds optional columns between driver releases. */
export function parseNvidiaProcessMetrics(
  output: string,
  gpuIndex: number,
  pids: Set<number>
): GpuContribution {
  const lines = output.trim().split(/\r?\n/);
  const header = lines.find((line) => /^#\s*gpu\s+pid\s+type\b/.test(line.trim()));
  if (header === undefined) {
    throw new Error('NVIDIA process telemetry is unavailable');
  }
  const columns = header
    .replace(/^\s*#\s*/, '')
    .trim()
    .split(/\s+/);
  const result: GpuContribution = { appEncodePercent: 0, appDecodePercent: 0, appMemoryBytes: 0 };
  const names = [
    ['enc', 'appEncodePercent', 1],
    ['dec', 'appDecodePercent', 1],
    ['fb', 'appMemoryBytes', 1024 ** 2],
  ] as const;
  for (const [column, field] of names) {
    if (!columns.includes(column)) {
      result[field] = null;
    }
  }
  let rows = 0;
  for (const line of lines) {
    if (line.trim().startsWith('#') || line.trim() === '') {
      continue;
    }
    const values = line.trim().split(/\s+/);
    if (Number(values[columns.indexOf('gpu')]) !== gpuIndex) {
      continue;
    }
    rows++;
    const pid = Number(values[columns.indexOf('pid')]);
    if (!pids.has(pid)) {
      continue;
    }
    for (const [column, field, factor] of names) {
      const raw = values[columns.indexOf(column)];
      const value = raw === undefined || raw === '-' ? NaN : Number(raw);
      if (!Number.isFinite(value) || value < 0 || (factor === 1 && value > 100)) {
        result[field] = null;
      } else if (result[field] !== null) {
        result[field] += value * factor;
      }
    }
  }
  if (rows === 0) {
    throw new Error('Missing NVIDIA process sample');
  }
  return result;
}

export async function getNvidiaProcessMetrics(
  gpuIndex: number,
  rootPid: number
): Promise<GpuContribution> {
  const pids = await applicationPids(rootPid);
  const { stdout } = await run(
    'nvidia-smi',
    ['pmon', '-i', String(gpuIndex), '-s', 'um', '-c', '1'],
    { windowsHide: true, timeout: 10000 }
  );
  return parseNvidiaProcessMetrics(stdout, gpuIndex, pids);
}

/** Count resident, private VRAM once per DRM client; never guess shared allocation ownership. */
export async function getDrmProcessMemory(
  pciAddress: string,
  rootPid: number
): Promise<number | null> {
  const pids = await applicationPids(rootPid);
  const clients = new Set<string>();
  let bytes = 0;
  let supported = false;
  for (const pid of pids) {
    let descriptors: string[];
    try {
      descriptors = await readdir(`/proc/${String(pid)}/fdinfo`);
    } catch {
      return null;
    }
    for (const descriptor of descriptors) {
      let info: string;
      try {
        info = await readFile(`/proc/${String(pid)}/fdinfo/${descriptor}`, 'utf8');
      } catch {
        continue;
      }
      if (/^drm-pdev:\s*(\S+)/m.exec(info)?.[1] !== pciAddress) {
        continue;
      }
      const id = /^drm-client-id:\s*(\d+)/m.exec(info)?.[1];
      if (id === undefined) {
        return null;
      }
      if (clients.has(id)) {
        continue;
      }
      clients.add(id);
      const resident = /^drm-resident-vram:\s*(\d+)\s+KiB\s*$/m.exec(info)?.[1];
      const shared = /^drm-shared-vram:\s*(\d+)\s+KiB\s*$/m.exec(info)?.[1];
      if (resident === undefined || shared === undefined || Number(shared) > 0) {
        return null;
      }
      supported = true;
      bytes += Number(resident) * 1024;
    }
  }
  return supported ? bytes : null;
}
