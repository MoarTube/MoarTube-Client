# Windows 11 FFmpeg candidate validation

Recorded October 27, 2026. This is a development candidate, not a certified or
published release. Build, packaging and staging are implemented inside this
repository; no signing credentials, drivers or existing global installation were
changed.

The client now requires this native dependency: source checkouts automatically
select `build/ffmpeg/install/<target>/bin`, before staged resources. The npm FFmpeg
module and automatic PATH fallback have been removed. Missing or incomplete
builds throw a compile-first startup error instead of being treated as a GPU
failure. Staged artifacts remain supported for packaged installations.

## Candidate and host

- FFmpeg and FFprobe: `9.0.2-moartube-win32-x64-r1`.
- FFmpeg SHA-256: `ca908a1dae7315c46ed4ed88588c544f19dbbd3ae2f35a02bb667ebc1dd2d372`.
- FFprobe SHA-256: `9f1e9569441215e11539b26b43815e73a1462b3720c70bcd5933a1a6381d5456`.
- Host: Windows 11 Home, build `26300`, x64.
- AMD Radeon(TM) Graphics: driver `32.0.21042.62`, selected DirectX adapter 1.
- NVIDIA GeForce RTX 5080: driver `32.0.16.1714`, selected through its UUID.
- Intel GPU: not available on this host; QSV compilation passed, execution pending.

`tooling/ffmpeg/sources.lock.json` pins FFmpeg's upstream revision and all codec/GPU
source archives. `toolchain.lock.json` pins the portable MSYS2 bootstrap and each
additional package. The compiler is Clang 23.1.4 with an NVPTX backend. Builds
preserve a generic x86-64 CPU baseline with runtime SIMD dispatch; independent
bit-for-bit reproducibility has not been established.

## Passing checks

| Check | Evidence |
| --- | --- |
| Full native build orchestration | `npm.cmd run ffmpeg:build:windows` completed |
| Required codecs, filters, muxers/demuxers, protocols, hardware backends and matching x64 PE executables | `build/ffmpeg/reports/win32-x64/result.json` and feature listings |
| PE dependency inspection | `dependencies.json`: only Windows OS imports; dynamically loaded GPU runtimes remain host prerequisites |
| Software media smoke checks | `software/result.json`: AV1 8/10-bit and HEVC input decoding; audio-bearing MP4/HLS/WebM/Ogg outputs, decode checks, image extraction and piped MPEG-TS preview extraction |
| Unicode/space paths | Smoke tests execute copied binaries and media under `media espace café 日本語` |
| AMD publishing and local live commands | `hardware-amf.json`: startup compressed-input probe, playable MP4/HLS, publishing geometry cases and live scaling |
| NVIDIA publishing and local live commands | `hardware-nvenc.json`: same pipeline checks and geometry cases |
| Real RTMP-to-HLS | Both backend reports include `windows-live-hardware.test.ts`: real loopback RTMP ingestion, 720p to 360p GPU scaling, H.264/AAC HLS output, matching FFprobe validation and decode checks |
| Hardware frame evidence | `rtmp-amf.txt`: D3D11 decoder frames and AMF encoder input context; `rtmp-nvenc.txt`: CUDA decoder and encoder contexts. Generated graphs contain GPU scalers and no CPU video scaling/download/reupload filters |
| Source integration | Unit tests, TypeScript checking and the client production build pass; artifact resolver verifies binary checksums and matches FFprobe |
| Candidate delivery | Local ZIP includes source archives, license materials, build recipe, checksums, provenance and test reports; staged resource selection was executed through FfmpegService |

The native geometry cases cover landscape, portrait and non-aligned dimensions
with even output sizing. The Ogg VP8/Opus path passes FFmpeg muxing/probing/decoding;
that does not establish intended browser/player compatibility for OGV.

## AMF fixes required by actual execution

The stock source passed an opaque D3D11 pixel format to AMF converter initialization
and failed with `AMF_NOT_SUPPORTED`. The recorded source patch instead uses the
input hardware frame context's underlying pixel layout. The client also requests
`SHADER=1` when creating its Direct3D device; without shader-readable decoder
textures, scaling failed with `AMF_DIRECTX_FAILED` on this host.

The final client uses Direct3D 11 hardware decoding, `vpp_amf` NV12 scaling on the
selected device, and AMF hardware surfaces as encoder input (`-pix_fmt amf`). The
same configuration is used for probing, publishing and live streaming. Neither
fix adds a CPU frame transfer.

## Remaining acceptance gates

Intel hardware execution, an independent clean rebuild, clean Windows 11 baseline
installation (intended minimum build 22000), older CPU testing, real MoarTube Node
delivery, intended player compatibility, long/VFR/corrupt media, cancellation,
concurrency/session limits, performance comparisons, installed Electron paths,
signing and update/rollback qualification remain pending. The short native tests
do not certify every codec/profile/bit depth or every GPU/driver combination.

Candidate manifests deliberately keep formal GPU and clean-host qualification
pending even when the current-host smoke tests pass. No release is published by
the build, package, stage or manual CI commands.
