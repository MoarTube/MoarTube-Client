# Linux ARM64 FFmpeg validation — 2026-10-28

Selected candidate: `9.0.2-moartube-linux-arm64-7671bbfcb6d86643-r62b9c8a6`.

The `linux-arm64` recipe builds FFmpeg and matching FFprobe 9.0.2 in a pinned
Ubuntu 24.04 ARM64 compiler container, with an ARMv8-A CPU baseline and a maximum
GLIBC symbol requirement of 2.39. This Windows host uses Docker Desktop's WSL 2
engine and QEMU ARM64 emulation. Emulated CPU execution does not qualify native
ARM64 GPU operation or desktop installation.

Passed: required compiled features; AArch64 ELF/dependency inspection; and
software media checks in both Ubuntu 24.04 and 26.04 ARM64 runtime containers.
Media checks cover the input fixture corpus, MP4/HLS/WebM/Ogg output, scaling,
JPEG extraction and previews from piped live segments. No test timeouts were
increased for emulation. The client resolver also selected the actual local pair.

FFmpeg SHA-256: `7671bbfcb6d86643a53a9669e55aebaee0a6c5588a172eb92fc39474da66fca7`.
FFprobe SHA-256: `71218c3e8517db320ec76574c5b7a24fe97c2ab32ab4d2f2b4e409e4ce5b0015`.

The initial dependency check rejected the normal AArch64 glibc loader.
`ld-linux-aarch64.so.1` is now allowed only for ARM64. Verification and packaging
were resumed from the original compiled pair using the corrected checker; the
unnecessary full recompilation retry was stopped. No upstream Linux source
patches were needed.

Maximum observed GLIBC requirement: 2.38. Final archives passed compressed-stream
integrity and full content comparison during packaging, followed by independent
native x64 Linux extraction. Extracted executable hashes match both Ubuntu
runtime reports, executable permissions are retained, all seven source-input
checksums match the lock, and the archived recipe hash matches the final source
tree. Runtime archive: 18.3 MiB; corresponding sources: 28.7 MiB.
An earlier corrupt archive was rejected; archive integrity/content checks are now
mandatory before Linux packaging writes release checksums.

## Build and verification

```powershell
npm.cmd run ffmpeg:build:linux:arm64
npm.cmd run ffmpeg:verify:linux:arm64:runtimes
```

The build checks required software codecs, CUDA/NVENC, VA-API, TLS, matching
versions, AArch64 ELF headers, dynamic dependencies and software media workflows.
The second command tests the exported pair in separate Ubuntu 24.04 and 26.04
ARM64 runtime containers. Reports record binary hashes, execution mode and package
versions. These containers have no compiler, system FFmpeg or vendor GPU drivers.

Outputs:

- Binaries: `build/ffmpeg/install/linux-arm64/bin/{ffmpeg,ffprobe}`.
- Selected candidate: `build/ffmpeg/state/linux-arm64/selected.json`.
- Runtime/source archives and checksums: `build/ffmpeg/releases/linux-arm64/<build-id>`.
- Feature, dependency and software evidence: `build/ffmpeg/reports/linux-arm64`.
- Ubuntu evidence: `ubuntu-24.04`, `ubuntu-26.04` and `runtimes.json` in that report folder.
- Final archive evidence: `archive-verification.json` and `archive-linux-check.txt`.

The corresponding-source archive contains all seven checksum-locked upstream
archives, their licenses, recipe, build evidence and binary hashes. Runtime
manifests conservatively leave subsequent Ubuntu checks pending; the separately
generated runtime reports record those checks without modifying sealed archives.

The ARM64 client selects the local pair automatically. Missing builds produce an
error with the ARM64 build command. Packaged ARM64 resources use the same manifest
and checksum validation as other targets. ARM64 Electron packaging is covered
separately by the [desktop guide](electron-linux.md).

Development regression checks passed: type checking, 159 client unit tests
(two opt-in hardware tests skipped), nine FFmpeg tooling tests, the existing
Windows compiled-feature check, and the existing Linux x64 feature/software
checks on both Ubuntu runtimes. Existing Windows and Linux x64 binary hashes
remained unchanged. CI now builds both architectures, using native
`ubuntu-24.04-arm` runners for ARM64; this local work did not launch remote CI.

## Remaining qualification

Native ARM64 CPU/desktop execution and actual NVIDIA/VA-API decode, scale and H.264
encode, publishing, live RTMP/HLS, adapter selection and cancellation require real
hardware and compatible drivers. This generic ARM64 target does not add or certify
Jetson, Raspberry Pi or other SoC-specific hardware video backends. Other Linux
distributions and musl are unqualified. The runtime needs the distribution's
VA-API, DRM, GnuTLS and C libraries; it is not fully static.

See [the Linux build guide](linux-ffmpeg.md) for prerequisites and installation.
