# Linux x64 FFmpeg builds

The first candidate has passed feature/software checks and both Ubuntu runtime
containers. See [the validation record](linux-ffmpeg-validation.md) for the exact
binary identity, evidence and remaining native GPU/desktop qualification.

The build baseline is Ubuntu 24.04 x64, with a maximum GLIBC symbol requirement
of 2.39 and generic x86-64 CPU tuning. Ubuntu 24.04 and 26.04 are the initial
runtime qualification targets. This does not claim compatibility with every
distribution or with musl-based distributions such as Alpine.

## Build from Windows 11, WSL or Linux

Use Node.js 22+ and Docker with a running Linux-container engine. On this Windows
machine Docker Desktop already uses WSL 2, so no additional WSL distro, global
compiler or GPU driver installation is needed. Docker is a developer build tool,
not an FFmpeg runtime requirement.

```powershell
npm.cmd run ffmpeg:build:linux
npm.cmd run ffmpeg:verify:linux:runtimes
```

Use `npm` instead of `npm.cmd` in WSL/Linux. The host command runs the same pinned
Ubuntu 24.04 container regardless of the host distro; using Ubuntu 26.04 in WSL
does not raise the release build baseline. Both the Ubuntu base image and Node
build-helper image are pinned by digest. Compiler packages come from the signed
Ubuntu archive snapshot `20261027T000000Z`. A pinned CA-data package bootstraps
HTTPS trust. Refresh these pins deliberately, rebuild, and requalify updates.
Ubuntu's snapshot service has a retention policy, so long-term rebuild support
also requires retaining the compiler image/toolchain inputs.

Upstream archives use the existing checksum-locked source revisions, with only
the Linux dependencies selected. No Windows AMF or MinGW patches are applied.
Compilation runs on a Docker-managed Linux volume to avoid NTFS performance and
permission problems. Source downloads reuse `build/ffmpeg/cache`. The Windows
work directory and installed binaries are separate and remain available.

Set `MOARTUBE_BUILD_JOBS` to control parallel compilation (default 8). The command
creates task-owned containers and an identified build-cache volume. Successful
build containers are removed; failed ones are retained for diagnostics. It never
prunes Docker globally or changes the default WSL distro. Build logs can be
redirected to `build/ffmpeg/linux-build.log`.

## Outputs and runtime dependencies

- Binaries: `build/ffmpeg/install/linux-x64/bin/ffmpeg` and `ffprobe`
- Feature, software, ELF and compiler reports: `build/ffmpeg/reports/linux-x64`
- Runtime and separate corresponding-source archives: `build/ffmpeg/artifacts/linux-x64`
- `selected.json` identifies the current candidate; `SHA256SUMS.txt` covers its archives.

The codecs and FFmpeg libraries are linked statically, while VA-API, DRM, GnuTLS
and the C runtime use distribution libraries. On Ubuntu install:

```bash
sudo apt install libva2 libva-drm2 libdrm2 libgnutls30t64 ca-certificates
```

Those distribution libraries are not bundled. They must be accounted for by a
future Linux application installer/package. Do not describe these executables as
fully static or dependency-free. GPU drivers are additional host prerequisites;
the build and CPU validation commands do not install or qualify them.

The client resolver already selects the local `linux-x64` binary pair when the
client runs on Linux. Executable permissions must be retained when transferring
from Windows; extract the runtime `.tar.xz` on Linux or run `chmod +x` on the pair.
Keep the runtime manifest, licenses and notices when staging resources. Publish
the matching source archive beside the runtime archive; the recipe, exact source
archives, licenses and binary hashes are included separately from the binaries.

## Capabilities and qualification

The compiled feature floor covers broad software decoding, JPEG previews,
libx264/AAC MP4 and HLS, libvpx/Opus WebM, RTMP, HTTP/HTTPS/TLS and matching
FFprobe. NVIDIA requires CUDA decoding, `scale_cuda`, and `h264_nvenc`; AMD and
Intel use VA-API decoding, `scale_vaapi`, and `h264_vaapi` on the selected DRM
render node. CUDA kernels use LLVM without the CUDA SDK or nonfree libnpp.

`ffmpeg:verify:linux:runtimes` tests the same exported binaries in separate pinned
Ubuntu 24.04 and 26.04 images. These images install only runtime libraries and
contain no compiler, system FFmpeg or vendor GPU drivers. Reports record exact
binary hashes and installed package versions. Container CPU checks do not
constitute native Linux desktop or GPU qualification. NVIDIA, AMD and Intel each
still require real Linux decode/scale/encode, publishing, RTMP/HLS live,
adapter-selection and cancellation tests before release claims.

The manual `ffmpeg-build-linux.yml` workflow uses the same recipe and uploads
runtime/source archives and reports. It does not publish a release. Linux Electron
packaging is available through the [desktop build](electron-linux.md); native GPU,
signing and full Node-connected desktop qualification remain separate work.

References: [Ubuntu snapshots](https://snapshot.ubuntu.com/),
[FFmpeg build instructions](https://github.com/FFmpeg/FFmpeg/blob/master/INSTALL.md).
