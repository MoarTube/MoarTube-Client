import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { GpuMetrics } from './gpu-metrics.js';

const run = promisify(execFile);

// WMI controller order is not the DirectX adapter order used by FFmpeg.
// Enumerate DXGI directly and use the PCI address as a persistent identity.
const adapterScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class MoarTubeAdapters {
    [StructLayout(LayoutKind.Sequential)]
    struct OpenAdapter { public uint Low; public int High; public uint Handle; }
    [StructLayout(LayoutKind.Sequential)]
    struct QueryInfo { public uint Handle, Type; public IntPtr Data; public uint Size; }
    [DllImport("gdi32.dll")]
    static extern int D3DKMTOpenAdapterFromLuid(ref OpenAdapter adapter);
    [DllImport("gdi32.dll")]
    static extern int D3DKMTQueryAdapterInfo(ref QueryInfo query);
    [DllImport("gdi32.dll")]
    static extern int D3DKMTCloseAdapter(ref uint handle);
    static string Identity(Desc d) {
        // LUIDs change after reboot. Prefer the physical bus/device/function.
        string fallback = "luid:" + d.LuidHigh.ToString("X8") + d.LuidLow.ToString("X8");
        var adapter = new OpenAdapter { Low = d.LuidLow, High = d.LuidHigh };
        if (D3DKMTOpenAdapterFromLuid(ref adapter) != 0) return fallback;
        IntPtr data = Marshal.AllocHGlobal(12);
        try {
            var query = new QueryInfo { Handle = adapter.Handle, Type = 6, Data = data, Size = 12 };
            if (D3DKMTQueryAdapterInfo(ref query) != 0) return fallback;
            if (Marshal.ReadInt32(data, 0) < 0) return fallback;
            return d.Vendor.ToString("X4") + ":" + d.Device.ToString("X4") + ":" +
                Marshal.ReadInt32(data, 0) + ":" + Marshal.ReadInt32(data, 4) + ":" + Marshal.ReadInt32(data, 8);
        } finally {
            Marshal.FreeHGlobal(data);
            D3DKMTCloseAdapter(ref adapter.Handle);
        }
    }
    [DllImport("dxgi.dll")]
    static extern int CreateDXGIFactory(ref Guid iid, out IntPtr factory);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int EnumAdapters(IntPtr self, uint index, out IntPtr adapter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int GetDesc(IntPtr self, out Desc desc);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Desc {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Name;
        public uint Vendor, Device, Subsystem, Revision;
        public UIntPtr VideoMemory, SystemMemory, SharedMemory;
        public uint LuidLow;
        public int LuidHigh;
    }
    public class Adapter {
        public uint Index, Vendor;
        public string Name, Id, Luid;
        public ulong VideoMemory;
    }
    public static Adapter[] List() {
        Guid iid = new Guid("7b7166ec-21c7-44ae-b21a-c9ae321ae369");
        IntPtr factory;
        Marshal.ThrowExceptionForHR(CreateDXGIFactory(ref iid, out factory));
        var result = new List<Adapter>();
        try {
            var enumerate = (EnumAdapters)Marshal.GetDelegateForFunctionPointer(
                Marshal.ReadIntPtr(Marshal.ReadIntPtr(factory), 7 * IntPtr.Size), typeof(EnumAdapters));
            for (uint i = 0; ; i++) {
                IntPtr adapter;
                int hr = enumerate(factory, i, out adapter);
                if (hr == unchecked((int)0x887A0002)) break;
                Marshal.ThrowExceptionForHR(hr);
                try {
                    var describe = (GetDesc)Marshal.GetDelegateForFunctionPointer(
                        Marshal.ReadIntPtr(Marshal.ReadIntPtr(adapter), 8 * IntPtr.Size), typeof(GetDesc));
                    Desc d;
                    Marshal.ThrowExceptionForHR(describe(adapter, out d));
                    result.Add(new Adapter { Index = i, Vendor = d.Vendor, Name = d.Name,
                        Id = Identity(d), VideoMemory = d.VideoMemory.ToUInt64(),
                        Luid = "luid_0x" + d.LuidHigh.ToString("X8") + "_0x" + d.LuidLow.ToString("X8") });
                } finally { Marshal.Release(adapter); }
            }
        } finally { Marshal.Release(factory); }
        return result.ToArray();
    }
}
'@
`;

const adaptersSchema = z.array(
  z.object({
    Index: z.number().int().nonnegative(),
    Vendor: z.number(),
    Name: z.string(),
    Id: z.string(),
  })
);

export async function getDirectXAdapters(): Promise<z.infer<typeof adaptersSchema>> {
  const stdout = await runAdapterScript(
    'ConvertTo-Json -InputObject @([MoarTubeAdapters]::List()) -Compress'
  );
  return adaptersSchema.parse(JSON.parse(stdout.replace(/^\uFEFF/, '')));
}

async function runAdapterScript(command: string): Promise<string> {
  // Send source through stdin rather than Windows command-line quoting/limits.
  const pending = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    windowsHide: true,
    timeout: 15000,
  });
  const input = pending.child.stdin;
  if (input === null) {
    pending.child.kill();
    await pending.catch(() => undefined);
    throw new Error('PowerShell stdin is unavailable');
  }
  input.on('error', () => pending.child.kill());
  input.end(`${adapterScript}\n${command}\n`);
  const { stdout } = await pending;
  return stdout;
}

/** Video engine usage and dedicated memory for the selected physical adapter. */
export async function getDirectXGpuMetrics(
  gpuId: string,
  rootPid: number = process.pid
): Promise<GpuMetrics> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    throw new Error('Invalid application process');
  }
  // The ID is base64 encoded rather than interpolated as PowerShell source.
  const encodedId = Buffer.from(gpuId, 'utf8').toString('base64');
  const stdout = await runAdapterScript(`
$gpuId = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedId}'))
$adapter = @([MoarTubeAdapters]::List()) | Where-Object {
    $vendor = if ($_.Vendor -eq 0x8086) { 'Intel' } elseif ($_.Vendor -eq 0x1002) { 'AMD' } else { 'Other' }
    (($vendor + ':' + $_.Id) -eq $gpuId) -or
        ($_.Vendor -eq 0x10de -and $_.Id -notlike 'luid:*' -and
        ('NVIDIA:' + (($_.Id -split ':')[-3..-1] -join ':')) -eq $gpuId)
} | Select-Object -First 1
if ($null -eq $adapter) { throw 'Selected GPU is unavailable' }
$appPids = [System.Collections.Generic.HashSet[uint32]]::new()
$hasApp = $false
try {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $hasApp = @($processes | Where-Object { $_.ProcessId -eq ${String(rootPid)} }).Count -gt 0
    if ($hasApp) {
        [void]$appPids.Add(${String(rootPid)})
        do {
            $added = $false
            foreach ($entry in $processes) {
                if ($entry.ProcessId -ne $PID -and $appPids.Contains($entry.ParentProcessId)) {
                    if ($appPids.Add($entry.ProcessId)) { $added = $true }
                }
            }
        } while ($added)
    }
} catch { $hasApp = $false }
$engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop |
    Where-Object { $_.Name -like ('*_' + $adapter.Luid + '_*') })
$totals = @{}
$appTotals = @{}
foreach ($engine in $engines) {
    $key = $engine.Name -replace '^pid_\\d+_', ''
    $totals[$key] += [double]$engine.UtilizationPercentage
    if ($hasApp -and $engine.Name -match '^pid_(\\d+)_') {
        if ($appPids.Contains([uint32]$Matches[1])) { $appTotals[$key] += [double]$engine.UtilizationPercentage }
    }
}
$encode = 0.0
$decode = 0.0
$appEncode = if ($hasApp) { 0.0 } else { $null }
$appDecode = if ($hasApp) { 0.0 } else { $null }
foreach ($key in $totals.Keys) {
    if ($key -match '_engtype_VideoEncode$' -and $totals[$key] -ge $encode) {
        $encode = [Math]::Min(100.0, $totals[$key])
        if ($hasApp) { $appEncode = [Math]::Min($encode, [double]$appTotals[$key]) }
    }
    if ($key -match '_engtype_VideoDecode$' -and $totals[$key] -ge $decode) {
        $decode = [Math]::Min(100.0, $totals[$key])
        if ($hasApp) { $appDecode = [Math]::Min($decode, [double]$appTotals[$key]) }
    }
}
$memoryUsed = $null
$memoryTotal = $null
try {
    $memory = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction Stop |
        Where-Object { $_.Name -like ('*' + $adapter.Luid + '_*') })
    if ($adapter.VideoMemory -gt 0 -and $memory.Count -gt 0) {
        $memoryUsed = ($memory | Measure-Object -Property DedicatedUsage -Sum).Sum
        $memoryTotal = $adapter.VideoMemory
    }
} catch { }
$appMemory = $null
if ($hasApp) {
    try {
        $allocations = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -ErrorAction Stop |
            Where-Object { $_.Name -like ('*_' + $adapter.Luid + '_*') })
        $appMemory = 0.0
        foreach ($allocation in $allocations) {
            if ($allocation.Name -match '^pid_(\\d+)_') {
                if ($appPids.Contains([uint32]$Matches[1])) { $appMemory += [double]$allocation.DedicatedUsage }
            }
        }
    } catch { $appMemory = $null }
}
ConvertTo-Json -InputObject @{
    encodePercent = [Math]::Min(100.0, $encode)
    decodePercent = [Math]::Min(100.0, $decode)
    memoryUsedBytes = $memoryUsed
    memoryTotalBytes = $memoryTotal
    appEncodePercent = $appEncode
    appDecodePercent = $appDecode
    appMemoryBytes = $appMemory
} -Compress
`);
  return z
    .object({
      encodePercent: z.number().min(0).max(100).nullable(),
      decodePercent: z.number().min(0).max(100).nullable(),
      memoryUsedBytes: z.number().nonnegative().nullable(),
      memoryTotalBytes: z.number().nonnegative().nullable(),
      appEncodePercent: z.number().min(0).max(100).nullable(),
      appDecodePercent: z.number().min(0).max(100).nullable(),
      appMemoryBytes: z.number().nonnegative().nullable(),
    })
    .parse(JSON.parse(stdout.replace(/^\uFEFF/, '')));
}

export async function getNvidiaDevices(): Promise<{ uuid: string; model: string }[]> {
  const { stdout } = await run('nvidia-smi', ['--query-gpu=uuid,name', '--format=csv,noheader'], {
    windowsHide: true,
    timeout: 10000,
  });
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(',');
      if (separator < 0) {
        throw new Error('Invalid NVIDIA GPU response');
      }
      return { uuid: line.slice(0, separator).trim(), model: line.slice(separator + 1).trim() };
    });
}
