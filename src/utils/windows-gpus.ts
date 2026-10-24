import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

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
        public string Name, Id;
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
                        Id = Identity(d) });
                } finally { Marshal.Release(adapter); }
            }
        } finally { Marshal.Release(factory); }
        return result.ToArray();
    }
}
'@
ConvertTo-Json -InputObject @([MoarTubeAdapters]::List()) -Compress
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
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', adapterScript],
    { windowsHide: true, timeout: 15000 }
  );
  return adaptersSchema.parse(JSON.parse(stdout.replace(/^\uFEFF/, '')));
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
