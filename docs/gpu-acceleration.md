# GPU acceleration

Client Settings offers hardware video backends that can complete a short H.264
transcode using the configured FFmpeg executable. Discovery alone does not establish that a decoder, scaler, encoder,
driver, or container device mapping works. Detected devices that fail the test
remain visible but cannot be selected; the client logs FFmpeg's failure details.
Checks run at startup, are cached for 30 seconds for settings reads, and run again
when selecting a GPU. Startup restores a saved GPU by its identity and refreshes
its device information. If that GPU is unavailable, startup selects CPU encoding.

| Host environment | Hardware video backend |
| --- | --- |
| Windows native | NVIDIA CUDA/NVENC, AMD Direct3D 11/AMF, or Intel Quick Sync |
| Linux native or Linux container | NVIDIA CUDA/NVENC or AMD/Intel VA-API |
| macOS native (Apple Silicon or Intel) | VideoToolbox, using macOS-managed hardware |
| Docker Desktop Linux container on macOS | CPU processing; no direct VideoToolbox access |
| Other operating systems | CPU processing |

Hardware availability, supported codecs, and driver compatibility depend on the
specific GPU. On Intel Macs, VideoToolbox selects the supported hardware through macOS. Docker Desktop on Windows supports an NVIDIA/WSL2 GPU route; the
Linux AMD backend does not establish AMD GPU access through Docker Desktop.

## Processing behavior

- NVIDIA HLS/MP4 publishing and HLS live streams use CUDA decoding,
  `scale_cuda` GPU scaling and NV12 conversion, and NVENC encoding. The scaler
  calculates even portrait/landscape dimensions directly; no software crop,
  frame download, or frame upload is used. Live streams use the selected output
  resolution. The selected GPU UUID
  restricts the child process to that device, and FFmpeg binds its hardware
  context to that device.
- AMD on Windows uses Direct3D 11 hardware decoding, `vpp_amf` GPU scaling/NV12
  conversion, and AMF hardware-surface H.264 encoding for publishing and live
  streams. The AMF context derives from the selected DirectX adapter. This new
  path requires the MoarTube candidate or another compatible FFmpeg build;
  the old bundled binary lacks `vpp_amf`. See the
  [native acceleration requirements](ffmpeg-distribution-plan.md#native-acceleration-requirements).
  Native qualification and public distribution are separate from implementation.
- Intel on Windows uses Quick Sync decoding, `vpp_qsv` hardware scaling and NV12
  conversion, and `h264_qsv` encoding for HLS/MP4 publishing and HLS live streams.
  The hardware session binds to the selected DirectX adapter index. Frames remain
  in QSV surfaces throughout; even dimensions are calculated in the hardware filter.
- AMD and Intel on Linux use VA-API decoding, `scale_vaapi` GPU scaling and pixel-format
  conversion, and `h264_vaapi` encoding for HLS/MP4 publishing and HLS live streams.
  Decoded frames remain on the chosen render device throughout the video pipeline.
  Portrait/landscape dimensions are rounded to even sizes within the GPU scaler,
  without CPU cropping, frame downloads, or uploads. Live streams use the selected
  output resolution. Audio encoding and application/network work still use the CPU.
- Native macOS uses VideoToolbox decoding, `scale_vt` hardware scaling, and
  `h264_videotoolbox` encoding for HLS/MP4 publishing and HLS live streams. Frames
  remain in VideoToolbox hardware buffers; portrait/landscape sizing and even
  dimensions are handled in the hardware filter. Live encoding uses the realtime
  hint. `-allow_sw 0` requires hardware encoding. macOS manages the underlying
  hardware, so the selector exposes one stable `videotoolbox:default` backend
  rather than claiming to select a physical GPU. Audio remains CPU-processed.
- WebM/OGV publishing continues using software codecs, regardless of GPU choice.
- One processing agent is selected for the client. Per-job GPU selection and
  scheduling across several GPUs are not implemented.

The probe reads an embedded three-frame H.264 Baseline sample and decodes, scales,
and encodes two frames using the selected device. It requires no software encoder
or network download to create the sample. Temporary probe files are removed after
the check, including on failure. The AMF, QSV, VA-API and VideoToolbox probes use the same hardware scaling paths
as publishing and live streams, so an encoder-only device is not offered as fully
usable. It does not guarantee hardware decoding support for every source codec,
profile, bit depth, resolution, or concurrent encoder workload. Jobs still report
FFmpeg errors if a particular source cannot be processed; there is no automatic
mid-job retry on the CPU. AMF, QSV, VA-API and VideoToolbox require hardware video frames
throughout their filter graphs; unsupported input decoding fails instead of silently using CPU
scaling. CPU processing remains an explicit selection in Client Settings.

## FFmpeg selection

The client resolves FFmpeg in this order:

1. `ffmpegPath` in `data/_client_settings.json` (source installations).
2. An explicit `FFMPEG_BIN` environment override, re-evaluated on each resolution.
3. The local compilation at `build/ffmpeg/install/<platform>-<architecture>/bin`.
4. A checksum-verified MoarTube artifact for this OS and process architecture in
   the application's resource directory, when there is no local compilation.

Installed Electron applications use their resource directory instead of a
developer build directory. Missing or incomplete binaries stop startup with a
compile-first error; CPU mode cannot replace the FFmpeg dependency.

The Windows build tooling produces MoarTube-built FFmpeg/FFprobe 9.0.2
executables invoked directly by TypeScript child processes, without native
Node.js FFmpeg bindings. Build tooling and source/dependency locks reside
in MoarTube-Client. See the [Windows tooling guide](../tooling/ffmpeg/README.md)
and [distribution plan](ffmpeg-distribution-plan.md).

The npm FFmpeg dependency has been removed. On Windows 11 x64, compile it with
`npm.cmd run ffmpeg:build:windows`; development then uses that build directly.
The automated recipe currently targets Windows x64. Other platforms need a native
build or explicit compatible override. An unusable configured executable does
not silently select another one, and an absent build never falls back to PATH.

Useful diagnostic commands, using the same executable as the client:

```sh
ffmpeg -hide_banner -encoders
ffmpeg -hide_banner -hwaccels
ffmpeg -hide_banner -filters
```

NVIDIA requires CUDA decoding, `scale_cuda` with NV12 conversion, and `h264_nvenc`.
Windows Intel requires QSV decoding, `vpp_qsv`, `h264_qsv` and a compatible Intel runtime.
Linux AMD and Intel require VA-API decoding, `scale_vaapi`, `h264_vaapi`, and a working
VA-API driver. Listing support is only a preliminary check; the client's transcode probe
also tests runtime initialization, device access, and compressed-input decoding.
Native macOS requires the `videotoolbox` hardware accelerator, `scale_vt` filter,
and `h264_videotoolbox` encoder. Merely listing the encoder is insufficient.

## Native macOS setup

Run the client as a native macOS Node.js process. In Client Settings, select
**VideoToolbox macOS hardware video**. The setting is enabled only after a real
compressed-input transcode succeeds. Saved selections are restored at startup
and fall back to CPU if the backend is no longer usable.

Check that the selected FFmpeg build includes VideoToolbox decoding,
`scale_vt` scaling, and `h264_videotoolbox` encoding. Some older or minimal builds
include the encoder but lack the hardware scaling filter. Build a compatible
native binary or use the existing `ffmpegPath` setting or
`FFMPEG_BIN` override with a suitable native macOS executable. Package platform
support alone does not establish hardware acceleration capability.

This backend applies to both Apple Silicon and supported Intel Macs; actual
source codec, profile, bit-depth, resolution and concurrency support depends on
the machine and macOS. It does not promise that every source can be accelerated.

A Linux container in Docker Desktop on macOS cannot directly use this backend.
For a hardware-accelerated Mac deployment, run the client natively and connect it
to the Node running in Docker through the Node's published host port. The client
must use a host-accessible address, not a container-only service hostname.

## Linux prerequisites and container preparation

For NVIDIA, install a compatible host driver and expose GPUs through NVIDIA's
container runtime when containerizing. Make `nvidia-smi` available for discovery.
Include `compute,video,utility` in `NVIDIA_DRIVER_CAPABILITIES` for CUDA,
encoding/decoding, and discovery. No desktop display server is required.

For AMD or Intel, provide the appropriate VA-API userspace driver (Mesa for AMD;
a compatible Intel media driver for Intel). Discovery reads AMD and Intel render devices from `/sys/class/drm`; FFmpeg must be able to open the
corresponding `/dev/dri/renderD*` device. Containerization must expose the render
device, retain readable sysfs metadata, and grant the container user permission
to open that device (usually through the host's render-group GID). Stable PCI
identity is saved separately from the render-node name so startup can update a
changed render-node assignment.

These application changes prepare the GPU backends. They do not add Dockerfiles,
Compose configuration, drivers, or GPU passthrough to the host.

References: [NVIDIA FFmpeg guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html),
[AMD Linux multimedia guidance](https://www.amd.com/en/resources/support-articles/release-notes/RN-AMDGPU-UNIFIED-LINUX-25-10-2.html),
[NVIDIA container capabilities](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/docker-specialized.html),
[Docker Desktop GPU support](https://docs.docker.com/desktop/features/gpu/),
[Apple VideoToolbox](https://developer.apple.com/documentation/videotoolbox),
[FFmpeg VideoToolbox scaling](https://github.com/FFmpeg/FFmpeg/blob/n7.0/libavfilter/vf_scale_vt.c).

## Verification

Live encoding writes a rolling HLS playlist and atomically completed segment
files under the video's local `adaptive/encoder` directory. Delivery uploads one
closed segment at a time; the GPU decoder/scaler/encoder options are preserved.
FFmpeg retains a 20-segment playlist plus its deletion allowance rather than
accumulating files indefinitely. Playlist reads are capped at 128 KiB and segment
reads at 64 MiB. Delivery that falls behind the retained window fails explicitly.
This replaces the legacy mixed segment/playlist stdout transport, whose inferred
`pipe:N.ts` segment URLs are rejected by FFmpeg 9. No FFmpeg source patch or GPU
fallback is needed for this transport change.

On Windows, `npm.cmd run test:gpu` requires and exercises each detected adapter;
`npm.cmd run test:gpu:e2e` also tests actual Client publishing/live journeys on
those adapters. See [the local integration guide](local-integration-runner.md).

Run `npm test` for discovery, selection, pipeline argument, filter geometry, and
capability-check regression tests. GPU hardware testing is opt-in:

```powershell
$env:MOARTUBE_TEST_GPU = '1'
npx vitest run tests/gpu-hardware.test.ts
```

On a Linux AMD machine, require the VA-API backend explicitly:

```sh
MOARTUBE_TEST_GPU=1 MOARTUBE_TEST_GPU_BACKEND=vaapi npx vitest run tests/gpu-hardware.test.ts
```

On a Mac, require VideoToolbox explicitly (set `FFMPEG_BIN` first if needed):

```sh
MOARTUBE_TEST_GPU=1 MOARTUBE_TEST_GPU_BACKEND=videotoolbox npx vitest run tests/gpu-hardware.test.ts
```

The hardware test requires a usable GPU, runs the compressed-input capability
probe, then executes the application's actual MP4 and HLS publishing commands.
It checks output files and decodes the generated MP4/transport-stream media to
verify that it is playable. An explicitly requested backend and vendor must be present and
pass its probes; another vendor cannot substitute for it. Live-stream input and
HLS options are covered by regression tests; the hardware test does not start an
OBS/RTMP session or a MoarTube Node. For NVIDIA, it also executes the live
scaling/encoding/HLS pipeline with a local compressed fixture instead of an RTMP
listener and checks actual portrait/landscape output dimensions on the GPU.

## Intel verification

On native Windows Intel hardware:

```powershell
$env:MOARTUBE_TEST_GPU = '1'
$env:MOARTUBE_TEST_GPU_BACKEND = 'qsv'
$env:MOARTUBE_TEST_GPU_VENDOR = 'Intel'
npx vitest run tests/gpu-hardware.test.ts
```

On Linux Intel hardware:

```sh
MOARTUBE_TEST_GPU=1 MOARTUBE_TEST_GPU_BACKEND=vaapi MOARTUBE_TEST_GPU_VENDOR=Intel npx vitest run tests/gpu-hardware.test.ts
```

Intel discovery, command generation, selection, persistence, probe failures and
sizing are covered by automated tests. Execution on actual Intel Windows/Linux
hardware remains to be validated. Driver installation remains the user's responsibility.
