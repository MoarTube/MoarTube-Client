# Linux FFmpeg validation — 2026-10-28

Candidate: `9.0.2-moartube-linux-x64-8828825bb7df5b22-r5e8a647b`.
Built from Windows 11 using the existing Docker Desktop WSL 2 Linux engine,
inside the digest-pinned Ubuntu 24.04 x64 compiler container. No additional WSL
distribution or host compiler was installed. Both Windows binaries remain in
their separate `win32-x64` installation directory.

## Passed

- Required CPU, CUDA/NVENC and VA-API compiled-feature inventory, including
  `scale_cuda`, `scale_vaapi`, hardware H.264 encoders, TLS and matching FFprobe.
- x64 ELF verification and dynamic-library allowlist inspection; no unresolved
  build-container dependencies. Maximum observed GLIBC symbol version: 2.38,
  below the Ubuntu 24.04 ceiling of 2.39.
- Software fixture decoding, MP4/HLS/WebM encoding and decoding, scaling,
  JPEG extraction and piped live-segment preview extraction.
- The same exported binary hashes passed feature and software tests in separate
  Ubuntu 24.04 and Ubuntu 26.04 runtime-only containers with declared runtime
  packages, no compiler, no system FFmpeg and no GPU drivers installed by us.
- Runtime archive executable permissions, separate source archive contents,
  and final SHA-256 archive checksums.
- Client type checking, 157 unit tests (two opt-in GPU tests skipped), six FFmpeg
  tooling tests, and the shared Windows feature verifier against the existing
  Windows pair.

FFmpeg SHA-256: `8828825bb7df5b222024e60b79c4ac268ddef9d14928da514aaa22db28235837`.
FFprobe SHA-256: `d2d0127c151d446ee9ddf0ac7f8b1f953df74ecfc81870b0f207368b653eebd4`.

## Artifacts and evidence

`build/ffmpeg/releases/linux-x64/<build-id>` contains the runtime `.tar.xz`, corresponding
source `.tar.xz` and `SHA256SUMS.txt`. The current selection lives at
`build/ffmpeg/state/linux-x64/selected.json`. Source archives include all
seven selected upstream inputs, their licenses, build recipe, compiler/package
records, software/feature evidence and binary identity. The runtime is about
21.3 MiB compressed; sources are about 28.7 MiB compressed.

Reports are under `build/ffmpeg/reports/linux-x64`, including `dependencies.json`,
`result.json`, `software/result.json`, `runtimes.json`, and per-distro
`ubuntu-24.04`/`ubuntu-26.04` reports and runtime package inventories. The manifests
inside the initial archives conservatively leave post-build runtime qualification
pending; the separately generated runtime reports record the subsequent tests.

## Still pending

These are container CPU/software checks, not clean physical desktop installation
or GPU certification. Native Linux NVIDIA, AMD and Intel publishing/live GPU
pipelines, adapter selection and cancellation require appropriate Linux hardware.
Full Node-connected client workflows and Linux Electron packaging/installers have
not been qualified by this work. Other distributions and architectures remain
unqualified. Runtime VA-API/DRM/GnuTLS libraries and vendor drivers are host
requirements; the binaries are not fully static.

See [the Linux build guide](linux-ffmpeg.md) for commands and prerequisites.
