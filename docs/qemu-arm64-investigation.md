# ARM64 Electron QEMU investigation — 2026-10-28

The unchanged MoarTube Client 1.1.0 ARM64 DEB and standalone downloads launched
and passed the installed/portable GUI suite in a full Debian Trixie ARM64 VM.
The earlier Docker failures concern QEMU user-mode emulation, not every form of
QEMU emulation. No application rebuild or sandbox-disabling flag was required.

## Isolated cause

A small C program called Linux `clone` for ordinary process creation and PID,
network and user namespaces. Both architectures ran with `SYS_ADMIN` in
otherwise equivalent disposable containers:

| Execution | Ordinary process | PID/network/user namespaces |
| --- | --- | --- |
| Native x64, default container seccomp | Passed | Passed |
| Native x64, container seccomp unconfined | Passed | Passed |
| ARM64 user-mode QEMU, default container seccomp | Passed | All failed: `EINVAL` |
| ARM64 user-mode QEMU, container seccomp unconfined | Passed | All failed: `EINVAL` |
| ARM64 kernel in full-system QEMU | Passed | Passed |

The same ARM64 probe binary passed under the full guest kernel. Removing the
disposable container's seccomp policy did not fix user-mode emulation. The app's
renderer sandbox remained enabled throughout the graphical tests.

QEMU documents namespace clone flags as unsupported in user-mode. Its syscall
implementation explicitly rejects `CLONE_NEWUSER`, `CLONE_NEWPID`,
`CLONE_NEWNET` and related flags. Chromium's namespace sandbox depends on these
operations. This explains the observed `clone: Invalid argument` and zygote
failure. The space-containing-path attempt also reported a truncated exec path;
testing a no-space path still failed at clone, so changing install paths did not
resolve the underlying limitation.

Sources: [QEMU threading documentation](https://www.qemu.org/docs/master/user/main.html#threading),
[QEMU clone flag implementation](https://github.com/qemu/qemu/blob/master/linux-user/syscall.c),
[Chromium zygote architecture](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/zygote.md).

## Full-system verification

The test uses `qemu-system-aarch64`, a generic `virt` machine, four Cortex-A76
CPUs, 4 GiB guest RAM, a Debian Trixie ARM64 filesystem and Debian's ARM64
6.12.113 kernel. The kernel uses 4 KiB pages. Unlike user-mode emulation, Linux
system calls and `/proc` are implemented by the guest kernel itself.

The first exploratory run passed both GUI tests and exported screenshots and
test records. Its minimal bootstrap then failed to find a power-off executable
after writing a successful test status. The maintained harness uses BusyBox
power-off and is tested separately; the exploratory shutdown fault is not an
application failure. The existing release hashes remain unchanged.

The repeatable verifier also requires renderer `/proc/<pid>/status` to report
`Seccomp: 2` and `NoNewPrivs: 1`, in addition to Electron's sandbox and context
isolation assertions. Native x64 Ubuntu 24.04/26.04 regression checks passed
with these additional assertions.

The maintained command passed end to end, including a clean guest power-off.
Both renderer processes reported seccomp mode 2, `NoNewPrivs` 1 and nested PID
namespaces. Both installed and portable runs passed UI, isolation, XDG/menu,
single-instance, settings/media preservation and shutdown checks; the installer
cycle and both backend/image probes passed as well. Current successful evidence:
`build/desktop/reports/linux-arm64/vm-trixie/1793237205518-4232/result.json`,
with screenshots in its `evidence/reports/linux-arm64` folder. The full run used
the original release checksums; downloads were not rebuilt by this investigation.

```powershell
npm.cmd run desktop:verify:linux:arm64:vm
```

See the [VM harness guide](../desktop/linux/vm/README.md) for resources, output
paths and cleanup. The initial control logs, VM serial log, screenshots and
records are in `build/desktop/reports/linux-arm64/qemu-deep-dive` and
`build/desktop/logs/linux-arm64/qemu-deep-dive`. Maintained runs use
`build/desktop/reports/linux-arm64/vm-trixie/latest.json` to identify their evidence.

This verifies ARM64 GUI execution under a real emulated ARM64 kernel with
software graphics. Native Pi hardware, Raspberry Pi OS integration, 16 KiB
kernel execution, Wayland, GPU video processing and complete Node-connected
publishing/live workflows remain separate qualification work.
