# Linux ARM64 Electron validation — 2026-10-28

This record describes the existing Node 22.23.4 packages. New builds pin Node
24.22.1; the recorded downloads and hashes remain unchanged until rebuilt.

MoarTube Client 1.1.0, Electron 45.1.0, bundled standalone Node 22.23.4,
Sharp 0.33.5 and FFmpeg/FFprobe
`9.0.2-moartube-linux-arm64-7671bbfcb6d86643-r62b9c8a6`.
Built from Windows 11 using Docker Desktop's WSL 2 engine and ARM64 QEMU
emulation in the pinned Ubuntu 24.04 builder. Existing dependency containers
were reused while resolving the Linux backend issue described below.

## Downloads

Files are in `build/desktop/releases/linux-arm64/1.1.0`:

| File | Size | SHA-256 |
| --- | --- | --- |
| `MoarTube-Client-1.1.0-linux-arm64.deb` | 157.2 MiB | `942df64dde070fda1f3d03af26fc6f4e4791af05012d163fa3aafabbd4a18558` |
| `MoarTube-Client-1.1.0-linux-arm64.tar.gz` | 198.8 MiB | `9c56a79bea3e5d2126412519d8003047306c540c7f60777523f27dda8afca33f` |
| `9.0.2-moartube-linux-arm64-7671bbfcb6d86643-r62b9c8a6-sources.tar.xz` | 28.7 MiB | `562416d06f5e805057e67fb6c8d07ebd29af5b7c7280ed97c3a4efc91273ff43` |

Matching checksums and release notes accompany the files. Publish the sources
beside the app; users do not need the source archive to run it. All Chromium
locales remain included. No release was published or host application installed.

## Passed

- ARM64 ELF checks for Electron, bundled Node, Sharp/native libraries and both
  FFmpeg executables; DEB architecture `arm64`, executable permissions, bundled
  Node license, compressed stream and DEB payload integrity.
- Independent extraction with native x64 Linux tools. Critical files in the DEB
  and standalone archive match, including the backend, ASAR, native modules,
  FFmpeg pair, bundled Node and licenses. Binary hashes match packaging reports.
- Static ELF checks for 16 KiB segment alignment in nine shipped executables and
  native libraries. This does not test execution on a physical 16 KiB kernel.
- The shipped Electron executable starts in Node mode under ARM64 emulation.
- On Ubuntu 24.04, Ubuntu 26.04 and Debian Trixie ARM64: APT installation and
  dependency resolution, desktop integration/CLI separation, AppArmor profile
  parsing, dynamic Electron dependency resolution, reinstall, uninstall and
  preservation of settings/media.
- On all three distributions, both installed and standalone packages run their
  bundled Node, Sharp and FFmpeg image-processing pipeline and real backend HTTP
  sign-in page. Real child-process IPC shutdown and parent-disconnect shutdown
  close the backend and its listener. Standalone tests use a Unicode/space path.
- The shared Linux x64 backend fix passed the full installed/standalone graphical
  suite on Ubuntu 24.04 and 26.04, with renderer sandbox and context isolation,
  File menu paths, XDG profiles, single instance and process shutdown verified.
- Type checking, 159 client tests (two opt-in hardware tests skipped), and desktop
  tests passed. The Linux process-tree test also passed inside the builders.

## Native ARM64 GUI qualification remains pending

**Follow-up:** the unchanged installed and standalone ARM64 apps passed the full
GUI suite in a full-system Trixie ARM64 VM. The earlier failure is specific to
user-mode emulation. See the [QEMU investigation](qemu-arm64-investigation.md)
and `npm run desktop:verify:linux:arm64` for the repeatable verification path.
Physical ARM64/Pi qualification remains pending.

The repeatable full-system command also passed direct kernel checks: both
renderers had seccomp mode 2, `NoNewPrivs` 1 and nested PID namespaces. The guest
completed the entire install/portable/reinstall/uninstall suite and powered off
cleanly. Its kernel is Debian ARM64 6.12.113 with 4 KiB pages, so the Pi's physical
16 KiB kernel and Wayland/GPU behavior remain untested. The original assets and
their checksums above are unchanged.

The earlier three user-mode ARM64 verification runs returned nonzero because Chromium's
graphical zygote could not start under QEMU. A separate no-space-path diagnostic
reported `clone: Invalid argument`, premature zygote exit and QEMU SIGTRAP. The
renderer sandbox was kept enabled throughout. Installer/backend successes do
not qualify the ARM64 UI or turn these failed complete runs into passes.

The manual GitHub `electron-build-linux-arm64.yml` workflow performs the complete GUI
tests on native `ubuntu-24.04-arm` rather than QEMU. It runs independently of
`electron-build-linux-x64.yml`, which builds and verifies only x64. Remote CI was not launched by this work. Physical Pi 5,
Raspberry Pi OS, 16 KiB kernel execution, Wayland, video hardware acceleration,
full Node-connected publishing/live workflows and future-version migrations
still require appropriate native testing. Debian Trixie containers are a useful
library compatibility check, not a physical Raspberry Pi OS certification.

## Linux backend isolation

The new image-processing test exposed a Sharp/libvips assertion under Electron
on Ubuntu 26.04 x64. Linux now runs the backend with bundled standalone Node,
isolating it from Electron's system GLib symbols. The dependencies/backend are
unpacked from ASAR; the shell remains in ASAR. The app manages the child through
IPC and owns its cleanup. Windows retains the existing utility process.
No Sharp dependency upgrade or user-installed Node runtime is needed.
See [Sharp's Electron/Linux conflict](https://sharp.pixelplumbing.com/install/#electron-and-linux).

## Evidence and commands

Reports are under `build/desktop/reports/linux-arm64`, including `package.json`,
`artifact-extraction.txt`, `elf-16k.json`, `verification.json`, and per-distro
`installed-backend-probe.json`, `portable-backend-probe.json`,
`installation-result.txt`, `gui-result.txt` and package/library inventories.
Logs are under `build/desktop/logs/linux-arm64`; native x64 GUI results are under
`build/desktop/reports/linux-x64/ubuntu-*`. Diagnostic containers were removed
after exporting evidence; normal failed verification runs retain them.

```powershell
npm.cmd run desktop:build:linux:arm64
npm.cmd run desktop:verify:linux:arm64
```

The verified ARM64 FFmpeg candidate must exist first. The verification command
now uses the working full-system Trixie VM by default. The explicit `:vm` alias
remains available. On native ARM64 Docker, use
`npm run desktop:verify:linux:arm64:native` for the three-distro container suite.
The container verifier rejects cross-architecture GUI testing before creating
test containers; the earlier failed runs above remain historical evidence.
See the [Linux desktop guide](electron-linux.md).
