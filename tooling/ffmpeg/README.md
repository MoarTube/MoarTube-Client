# Windows 11 FFmpeg distribution

Linux x64 now has a separate Ubuntu 24.04 container recipe, with Ubuntu 24.04 and
26.04 runtime checks: `npm run ffmpeg:build:linux` followed by
`npm run ffmpeg:verify:linux:runtimes`. Docker Desktop's WSL 2 backend supports
building from Windows. See [the Linux guide](../../docs/linux-ffmpeg.md).

The first target is Windows 11 x64 (`win32-x64`), using FFmpeg and FFprobe
9.0.2. This directory contains checksum-locked sources and a portable MSYS2
CLANG64 toolchain, native build recipes, source patches, verification scripts,
synthetic input fixtures and candidate packaging. Developers must compile the
matching native dependency before starting the client or running media tests.
There is no npm-provided FFmpeg binary or automatic PATH fallback.

## macOS Intel builds

On native Intel macOS 15+ with Node.js 24.22.1 or newer, Xcode command line tools, cmake,
ninja, meson, nasm, pkg-config and xz, run `npm run ffmpeg:build:darwin`.
The GitHub **macOS Intel x64 FFmpeg candidate** workflow builds FFmpeg separately;
**macOS Intel x64 Electron candidate** also compiles it before packaging Electron.
Both provide native Mac environments for Windows developers.
Native qualification is pending the first workflow run.
See [the macOS guide](../../docs/electron-darwin.md) for details.

## Build and consume a candidate

Use native Windows x64 Node.js 24.22.1 or newer. No global compiler, MSYS2 installation,
CUDA toolkit or GPU driver installation is performed. The first build needs
network access and several GB of free disk space; the complete AMF source archive
alone is approximately 380 MiB. All generated files stay under `build/ffmpeg`.

```powershell
npm.cmd run ffmpeg:build:windows
npm.cmd run ffmpeg:package:windows
```

The build verifies cached/downloaded SHA-256 hashes, installs only the locked
toolchain packages, extracts pinned source archives, applies recorded patches,
and builds static codec libraries plus FFmpeg and FFprobe. It then checks compiled
features, PE imports and software media behavior. Set `MOARTUBE_BUILD_JOBS` to
adjust the default eight compile jobs. A hash mismatch fails instead of silently
downloading a different version. A changed lock requires a fresh work directory.
Never delete a work directory while its compiler processes are running.

x264 and dav1d archives use their GitHub mirrors because VideoLAN's archive
endpoints return HTTP 406 to automated builds. The mirror downloads were
verified against the existing locked SHA-256 values; codec versions, revisions,
archive filenames and source bytes are unchanged. All targets share this lock.

All source/toolchain downloads share a streaming HTTPS downloader. Connection
attempts still have a 10-second limit. Temporary network failures and HTTP
408/425/429/5xx service failures get up to ten attempts with exponential backoff capped at 8 seconds;
30 seconds without socket activity and a 10-minute total transfer budget bound
each attempt. Redirects are limited and HTTPS cannot downgrade to HTTP. Permanent
HTTP errors and checksum mismatches fail immediately. Partial files are removed;
only a complete, SHA-256-verified archive enters the local cache.

The six desktop/FFmpeg build workflows restore archive caches keyed by OS and
source locks (plus the Windows toolchain lock). A cache is saved only after all
required archives pass their checksums, including when a later compiler/test
step fails. Restored archives are checked again before use. Windows
fetches its sources before spending time installing the compiler toolchain.

The workflows also prepare desktop/compiler/test dependencies up front and use
a separate validated cache of compiled FFmpeg candidates to skip unchanged
compilations. See [build preparation and caching](../../docs/build-preparation-and-caching.md)
for cache keys, offline Linux checks and GitHub retention behavior.

The binaries land in `build/ffmpeg/install/win32-x64/bin`. Candidate ZIPs and their
SHA-256 files land in `build/ffmpeg/releases/win32-x64/<build-id>`; unpacked
candidates live in `build/ffmpeg/candidates/win32-x64/<build-id>`. Packages include corresponding
upstream source archives, the actual recipe and patches, license materials,
toolchain lock, checksums, provenance and qualification reports. Packaging does
not publish or certify a release.

Development automatically selects the compiled executables from
`build/ffmpeg/install/<platform>-<architecture>/bin` (on Windows 11 x64,
`win32-x64`). Recompiling updates the binaries used by the next client launch;
no staging or override is needed. Missing FFmpeg or FFprobe throws an actionable
startup error before GPU assessment, CPU fallback or media-directory cleanup.
An explicit `FFMPEG_BIN` or client `ffmpegPath` can select another executable.

To prepare resource files from an unpacked candidate for packaging:

```powershell
npm.cmd run ffmpeg:stage:windows -- "build/ffmpeg/candidates/win32-x64/<build-id>"
```

Staging checks binary hashes and copies a new immutable build into
`resources/ffmpeg/win32-x64`. It switches the manifest atomically and retains old
build directories, so active jobs keep their original executable. Source checkouts
continue to prefer the local compiled build. The resolver uses settings override,
`FFMPEG_BIN`, the matching local compilation, then a verified matching resource
artifact. It never substitutes a different architecture or searches PATH when a
build is missing. Electron uses `process.resourcesPath` for packaged resources
and does not consult a developer checkout's build directory. Executables must
remain outside ASAR. Stop running media jobs before rebuilding local binaries;
the local compiler's install directory is mutable.
Startup logs the selected executable, version and MoarTube build identity.
`FfmpegService.getProbePath()` resolves the matching probe for packaged artifacts
or a sibling probe for explicit overrides. Source and license materials accompany
the staged binary; no driver installers are included.

Windows Electron releases split the full candidate into runtime resources and a
separate corresponding-source ZIP. The application retains both executables,
license texts and source-download information. Publish the matching source ZIP
alongside every installer/application ZIP; users need not download it to run the
client. See [the desktop release instructions](../../docs/electron-windows.md#github-release-assets).

The manual `.github/workflows/ffmpeg-build-windows-x64.yml` workflow builds and
uploads candidates with read-only repository permissions and no publishing keys.
Its hosted Windows Server runner does not replace clean Windows 11 or GPU tests.

## Required capabilities

`features/win32-x64.json` records the minimum inventory derived from
`src/services/video-publish.ts`, `live-stream.ts`, `video-import.ts`,
`ffmpeg.ts` and `src/utils/gpu-encoding.ts`. It is a required feature floor,
not a configure allowlist: preserve broad upstream input support.

| Workflow | Required capabilities |
| --- | --- |
| CPU publishing | libx264/AAC for MP4/HLS; libvpx-vp9/Opus for WebM; existing libvpx/Opus Ogg path pending playback validation |
| Import and previews | Broad software input decoding, JPEG encoding, software scaling/cropping/pixel conversion, audio resampling, file and pipe I/O |
| Live and recording | RTMP server ingestion of FLV, HLS manifests and MPEG-TS segments, timestamps, H.264 Annex B handling, segment preview extraction |
| NVIDIA | CUDA/NVDEC decoding, scale_cuda with NV12 hardware frames, h264_nvenc; h264_cuvid for the current recorded MPEG-TS publishing path |
| AMD | Direct3D 11 hardware decoding, vpp_amf scaling/conversion with validated hardware surfaces, h264_amf |
| Intel | QSV hardware decoding, vpp_qsv scaling/NV12 conversion, h264_qsv with the selected DirectX adapter |
| Diagnostics | Matching ffprobe; version, configuration, license, codec, filter, format, bitstream filter and protocol reports |

Each GPU pipeline must apply the requested output resolution for publishing and
live streams, preserve portrait/landscape aspect ratio with even dimensions, and
avoid CPU video scaling/cropping or hardware-frame downloads and reuploads.
Audio and muxing can run on the CPU. Hardware codec/profile availability still
depends on the selected GPU and driver.

The AMD client now shares `vpp_amf` scaling between publishing, live and probing.
It requests Direct3D 11 decoder surfaces, derives the AMF filter context from the
selected DirectX adapter, enables shader-readable decoder textures, sets NV12
surface layout and requires AMF hardware
surfaces as encoder input. It rejects software scaling and missing adapter
selection. Native execution and graph qualification remain separate acceptance
gates; the old bundled binary lacks `vpp_amf` and will fail the updated AMD probe.
The recorded `ffmpeg-amf-hardware-input-layout` patch passes the input surface's
underlying layout to AMF's converter initialization instead of the opaque D3D11
pixel format. It does not download frames or introduce CPU video processing.

Current-host AMD and NVIDIA publishing, portrait/geometry and real loopback
RTMP-to-HLS checks passed on Windows 11. Intel execution and full release
qualification remain pending. The [validation record](../../docs/windows-ffmpeg-validation.md)
identifies the host, binary hashes, evidence and untested acceptance gates.

Software AV1 decoding uses pinned dav1d, rather than relying on an AV1 hardware
wrapper. zlib preserves PNG/compressed input support. HTTPS uses Windows Schannel
and the OS certificate store. CUDA filters compile using Clang's NVPTX backend
with an `sm_52` target and no proprietary CUDA toolkit/libnpp dependency. QSV uses
a static oneVPL dispatcher; the Intel graphics runtime still comes from the host.
The unused Windows screen-capture `gfxcapture` filter is disabled because its
WinRT C++ headers fail with this toolchain. The client ingests live media through
RTMP and does not use that filter.

## Check a candidate

Run natively on Windows with explicit executable paths; no binary is downloaded
or selected from PATH:

```powershell
npm run ffmpeg:verify:windows -- "C:\artifacts\ffmpeg.exe" "C:\artifacts\ffprobe.exe"
npm run ffmpeg:test:tooling
```

An optional third argument sets the report directory. The default is
`build/ffmpeg/reports/win32-x64`, ignored by Git. The check validates x64 PE
headers, matching requested versions, GPL configuration, absence of
`--enable-nonfree`, and each required feature. Missing features produce a
nonzero exit status and `result.json` lists omissions. Input and output protocol
support are checked independently. Each listing is retained as evidence.

This verifies compiled features only. It cannot establish hardware operation,
binary/source identity, runtime dependency closure, redistribution compliance,
or media playback. A successful result always leaves hardware qualification
pending. Never treat it as release acceptance.

## Work remaining before a Windows release

1. Validate a clean rebuild from the recorded locks on an independent host and
   resolve any upstream archive retention issues before public release. The
   source/compiler inputs are pinned; bit-for-bit reproducibility is not claimed.
2. Test the intended Windows 11 baseline (build 22000) and portable x86-64/SSE2
   CPU baseline on clean hosts. Current-host execution is insufficient evidence
   for the oldest OS/CPU. PE imports do not enumerate dynamically loaded drivers.
3. Qualify AMD's hardware surface interop and all Windows GPU backends.
4. Exercise complete client software workflows and validate outputs using FFprobe
   and decode/playback checks. Include invalid/truncated inputs, audio layouts,
   portrait/square/odd dimensions and long/VFR media. Check Unicode/space paths
   and clean Windows 11 hosts without a compiler or separate FFmpeg install.
5. Qualify NVIDIA, AMD and Intel independently using actual publishing and real
   RTMP/HLS commands, requested resolutions, adapter selection, cancellation,
   concurrent jobs and failure cases. Capture hardware frame graphs and driver
   context. A skipped vendor test is pending, never passing evidence.
6. Validate installed application paths, signing and rollback. Electron packaging
   follows artifact validation. The current candidate scripts do not sign, publish
   releases, provision a MoarTube Node, install drivers or certify untested GPUs.

Linux x64 and ARM64 builds use the shared Docker recipe. Run
`npm run ffmpeg:build:linux:arm64` for ARM64 and
`npm run ffmpeg:verify:linux:arm64:runtimes` for Ubuntu 24.04/26.04 CPU checks.
See the [Linux guide](../../docs/linux-ffmpeg.md) for both architectures,
runtime dependencies and GPU qualification limits.

See [the distribution plan](../../docs/ffmpeg-distribution-plan.md) for the full
acceptance criteria and later platforms.
