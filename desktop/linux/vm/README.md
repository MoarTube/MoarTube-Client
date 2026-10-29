# ARM64 desktop verification with a full Linux guest

Run from the repository root after building the ARM64 desktop downloads:

```powershell
npm.cmd run desktop:verify:linux:arm64
```

The explicit `desktop:verify:linux:arm64:vm` command remains an alias.
For native ARM64 Docker container checks across Ubuntu and Trixie, use
`desktop:verify:linux:arm64:native`. Cross-architecture container GUI checks are
rejected before test containers are created. ARM64 builds and FFmpeg checks
continue to support user-mode emulation.

Requires Node.js 22+, Docker's Linux engine, at least 6 GiB available Docker RAM
and roughly 8 GiB temporary disk space. The guest uses four Cortex-A76 virtual
CPUs and 4 GiB RAM. No extra WSL distribution, Windows QEMU installation, KVM,
privileged host container, or global binfmt/namespace configuration is needed.

The verifier checks release checksums, prepares a Debian Trixie ARM64 filesystem
and kernel, and boots them with native-host `qemu-system-aarch64` using TCG.
The exact DEB and standalone downloads run as an ordinary guest user under Xvfb.
Existing installer/backend/GUI tests cover real IPC, preservation, isolation,
single-instance behavior and shutdown. Linux GUI tests additionally inspect the
renderer process for seccomp filtering and `NoNewPrivs`.

This bypasses QEMU **user-mode** syscall translation. User-mode QEMU rejects
namespace clone flags required by Chromium's sandbox. A full-system guest has
its own ARM64 kernel to execute these calls. The app and its sandbox settings
are unchanged. `namespace-probe.c` is the small control experiment used to
isolate this limitation; it can be compiled with GCC in the existing native and
ARM64 desktop builder images, then run with the same container capabilities.

Reports, screenshots and guest package inventory are under
`build/desktop/reports/linux-arm64/vm-trixie/<run-id>`. `latest.json` points to
the most recent successful result. Logs use the corresponding
`build/desktop/logs/linux-arm64/vm-trixie/<run-id>`. On success, temporary
containers, the private disk volume and the large exported filesystem tar are
removed. Failed runs retain diagnostics and print their exact resource names;
an active VM is stopped after a timeout. Compiler/emulator images remain cached.

The base images are pinned; APT kernel/runtime updates are recorded in the guest
inventory. Bit-for-bit reproducibility is not claimed. This is a generic ARM64
machine with a Debian kernel and software X11 graphics. It does not emulate the
Pi 5 SoC, its 16 KiB kernel, Wayland, GPU/video devices or connected MoarTube Node
workflows. Physical-device qualification remains separate.

References: [QEMU user-mode threading](https://www.qemu.org/docs/master/user/main.html#threading),
[ARM system emulation](https://www.qemu.org/docs/master/system/target-arm.html).
