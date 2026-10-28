# MoarTube FFmpeg Distribution Plan

Prepared for MoarTube maintainers on October 27 2026.

## Purpose and recommendation

Build and publish MoarTube-owned FFmpeg distributions for the native Windows,
Linux, and macOS client. Use a common feature specification, pinned source
versions, platform build recipes, and release tests to make the executables
consistent and supportable. Bundle a tested distribution with the future Electron
application so users do not need to download or compile FFmpeg themselves.

The selected upstream version for MoarTube-owned distributions is **FFmpeg
9.0.2**, with matching FFprobe 9.0.2, across all target platforms. Pin its exact
source revision and archive checksum in the repository's build inputs. The
Windows candidate now implements this baseline. Developers must compile the
native dependency; the npm binary dependency and automatic PATH fallback have
been removed.

Keep the entire FFmpeg build and release process in the existing
`MoarTube-Client` repository. Store recipes, dependency locks, platform definitions,
verification scripts, CI workflows, and application integration together so one
change can be reviewed and tested across the complete application build. The
first deliverable is a validated FFmpeg artifact; Electron installers follow
after the client can reliably consume that artifact.

MoarTube would own dependency selection, build configuration, artifact verification,
testing, and release maintenance. Upstream FFmpeg, codec libraries, compilers, and
OS APIs remain dependencies. GPU driver installation and upgrades remain the
user's responsibility. The application should diagnose unavailable acceleration
without attempting to install or repair drivers.

### Selected integration architecture

The TypeScript client will invoke MoarTube-built `ffmpeg` and `ffprobe`
executables directly through managed child processes. Build these executables
from pinned upstream FFmpeg 9.0.2 source and explicitly locked dependencies.
MoarTube controls the source inputs, configure options, compiled features,
runtime dependencies, artifact identity and qualification evidence.

Native Node.js bindings such as `node-av` and `beamcoder`, direct in-process
`libav*` integration, and third-party prebuilt FFmpeg distributions are outside
the selected architecture. Retain the current executable-based pipeline and
process isolation; implement backend differences in the client's argument and
capability helpers. Existing third-party binaries remain reference artifacts and
historical comparison artifacts during migration; they are not runtime fallbacks.

Application orchestration stays in TypeScript, while CI builds a separate native
artifact for each supported OS and CPU architecture. Package the matching tested
artifact automatically so users need no compiler, SDK, or separate FFmpeg
installation. Keep all recipes, locks, tests and workflows inside MoarTube-Client;
there is no separate FFmpeg build repository.

## Scope

### First implementation target: Windows 11 x64

The first implementation targeted **Windows 11, `win32-x64`**. Linux x64 FFmpeg
and Electron packaging followed with an Ubuntu 24.04 baseline; macOS remains a
planned follow-up. Windows ARM64 and x86
are not included in this first target. Keep the portable x86-64 CPU baseline;
do not require AVX/AVX2 or tune binaries for the build machine. The oldest
supported Windows 11 build must be recorded and tested before release.

The first Windows artifact must include matching FFmpeg and FFprobe 9.0.2,
all client software codecs, input decoding, containers, images, filters and
network protocols, plus **all three Windows hardware backends**: NVIDIA,
AMD and Intel. Each hardware backend must decode, scale and convert video on
the GPU and encode H.264 for MP4/HLS publishing and RTMP-to-HLS live streams.
No backend is optional merely because the build host lacks that vendor's GPU.
Hardware qualification requires separate suitable hosts/adapters.

The audited initial feature inventory is
[`tooling/ffmpeg/features/win32-x64.json`](../tooling/ffmpeg/features/win32-x64.json).
The [Windows tooling guide](../tooling/ffmpeg/README.md) describes the compiled
feature check and remaining acceptance gates. The Windows implementation now
builds and packages a local candidate, integrates artifact resolution, and uses
`vpp_amf` in AMD publishing, live streaming and probing. Current-host software,
AMD and NVIDIA smoke tests passed; Intel execution, clean-host testing and full
release qualification remain pending. See the
[Windows validation record](windows-ffmpeg-validation.md).

Keep broad decoding enabled, including common H.264, HEVC, VP8, VP9 and AV1
inputs. Preserve existing CPU WebM/OGV commands during the build audit, but
resolve the existing VP8/Opus-in-Ogg playback question before claiming OGV
compatibility. Do not substitute a smaller encoder-only build for this scope.

The work includes FFmpeg and matching FFprobe executables, required software
libraries, native acceleration features, portable packaging, source and license
materials, CI automation, hardware qualification, and client integration. Include
release manifests, checksums, provenance, rollback instructions, and maintenance
procedures as supported parts of the distribution.

Native desktop execution is the deployment model. Container images, Docker GPU
passthrough, WSL configuration, driver installers, and a new media processing
engine are outside this project. A later container distribution may reuse suitable
Linux artifacts after separate validation.

This plan does not authorize publishing releases, buying signing credentials or
hardware, or changing existing user installations.
Those are implementation and operational actions after the plan is adopted.

## Current application and binary baseline

The previous implementation used `ffmpeg-static` 5.3.0. The dependency is now
removed; development selects the matching local compilation, with verified
resource artifacts available for packaging. The old package downloaded different
prebuilt executables by OS and architecture; it does not compile a common feature
set when installed. Its configured binary release is `b6.1.1`, whose individual
assets do not all identify as the same FFmpeg version.

Inspection of those exact release assets found the following:

| Existing asset | Evidence | Consequence |
| --- | --- | --- |
| Windows x64 | FFmpeg 6.1.1 with AMF, NVIDIA encoding and CUDA filters; actual client publishing tests passed on Windows AMD and NVIDIA hardware | Working reference for output behavior and hardware selection |
| Linux x64 and ARM64 | Required NVIDIA and VA-API encoder and scaling names absent from the inspected binaries | These assets cannot supply the implemented Linux GPU pipelines |
| macOS Intel x64 | FFmpeg 6.1.1 with VideoToolbox decoding and encoding symbols and `scale_vt` | Candidate reference; native Mac execution has not been validated |
| macOS Apple Silicon ARM64 | FFmpeg 6.0.0 with VideoToolbox decoding and encoding, without `scale_vt` | A newer source build is needed for the complete implemented pipeline |

Binary symbol inspection establishes compiled feature evidence, not successful
execution on another OS. The Linux and macOS hardware paths still need native
qualification. Existing client tests are a starting point and do not certify
future custom executables.

The client already has a central `FfmpegService`, settings and environment path
overrides, CPU processing, Windows AMD, Intel QSV and NVIDIA paths, Linux AMD/Intel VA-API and NVIDIA
paths, and a native macOS VideoToolbox path. Hardware selection uses a real
compressed-input transcode probe. The probe and regression tests should be reused.

## Product requirements

1. Installation must deliver an executable that runs without a developer toolchain
   or a separate user installation of FFmpeg.
2. Required CPU processing must work on every supported target. Hardware features
   must be compiled into applicable targets and qualified on suitable hardware.
3. The client must select the artifact matching its process architecture and OS.
4. Application updates must not overwrite settings, source media, recordings, or
   another active job's executable.
5. Packaged executables must run from paths containing spaces and non-ASCII text.
6. A build must fail if a required feature is missing. A passing compilation alone
   is not a release qualification.
7. Users must be able to see the selected executable, FFmpeg version, MoarTube
   build identity, and capability failure details through diagnostics.
8. Hardware limits on codecs, dimensions, profiles, bit depth, and simultaneous
   sessions must be reported honestly. Compiling support does not remove them.
9. Every supported native hardware backend must provide hardware decoding, GPU
   scaling for publishing, GPU scaling for live streams, and hardware H.264
   encoding. The desired outcome is **Yes in every processing column** below.
   CPU scaling, CPU cropping, and video-frame downloads/uploads between these
   stages do not satisfy the hardware pipeline requirement.

### Desired native hardware processing matrix

This is the required outcome for the FFmpeg 9.0.2 distribution and corresponding
client implementation, not a claim that every row is already implemented or
hardware-qualified. It applies to MP4/HLS publishing and HLS live streams with
supported source codecs and profiles on compatible hardware.

| Native backend | Hardware decode | GPU scaling: publishing | GPU scaling: live | Hardware H.264 encode |
| --- | --- | --- | --- | --- |
| NVIDIA CUDA / NVENC on Windows and Linux | Yes | Yes | Yes | Yes |
| AMD Direct3D 11 / AMF on Windows | Yes | Yes | Yes | Yes |
| Intel Quick Sync on Windows | Yes | Yes | Yes | Yes |
| AMD / Intel VA-API on Linux | Yes | Yes | Yes | Yes |
| VideoToolbox on macOS | Yes | Yes | Yes | Yes |

For Windows AMD, the implementation replaces publishing's CPU scaler and adds
live-stream GPU scaling through `vpp_amf`, shared with the capability probe.
The Windows source recipe patches AMF's Direct3D input-layout handling and the
client requests shader-readable decoder surfaces. Keep these changes together;
upgrading the FFmpeg executable alone does not complete this requirement.

Keep decoded video in hardware through scaling, pixel-format conversion and
encoding. Calculate even portrait/landscape output dimensions in the hardware
filter, and apply the selected output resolution to live streams. CPU work for
audio, muxing, networking and application coordination remains expected;
WebM/OGV software encoding and explicit CPU mode remain separate supported paths.

## Target platforms and compatibility policy

| Target identifier | Required processing | Initial validation |
| --- | --- | --- |
| `win32-x64` | CPU, NVIDIA CUDA and NVENC, AMD Direct3D 11 and AMF, Intel QSV | Windows CPU tests plus separate NVIDIA, AMD and Intel hardware runs |
| `linux-x64` | CPU, NVIDIA CUDA and NVENC, AMD/Intel VA-API | Baseline Linux environment plus NVIDIA, AMD and Intel hardware runs |
| `darwin-x64` | CPU and VideoToolbox | Native Intel Mac with a supported hardware video path |
| `darwin-arm64` | CPU and VideoToolbox | Native Apple Silicon Mac |
| `linux-arm64` | CPU required; GPU support only where explicitly qualified | ARM64 host and representative Raspberry Pi testing |

Recommended initial release targets are the four desktop targets, with Linux
ARM64 added before claiming continuity for ARM64 users. The existing README
advertises Raspberry Pi support. Inventory actual ARM32 and ARM64 requirements
before removing the existing package's broader platform coverage. Windows ARM64,
Windows x86, Linux ARM32, and specialized devices such as Jetson require explicit
support decisions and their own recipes and tests.

Before implementation, record minimum Windows, macOS, Linux glibc, and CPU ISA
requirements for each target. Align them with the selected Node.js and Electron
versions. Do not publish an artifact until its minimums have been tested. Build
Linux against the oldest supported userspace baseline, and avoid `-march=native`
or build-machine-specific tuning in portable releases.

Apple Silicon and Intel macOS need separate artifacts initially. A universal
binary is optional follow-up work after both independent targets pass. It adds
dependency merging and signing complexity without changing acceleration support.

## Required FFmpeg feature specification

Maintain a machine-readable specification derived from actual client commands.
Separate requirements shared by all targets from requirements for each backend.
Include both feature names and execution tests; a feature listing is insufficient.

| Area | Required baseline | Verification |
| --- | --- | --- |
| CPU video encoding | `libx264`, VP8 through `libvpx`, VP9 through `libvpx-vp9` | Encode and decode representative outputs |
| Audio encoding | Native AAC and `libopus` | Audio-bearing MP4, HLS, WebM and OGV cases |
| Input decoding | Existing supported inputs, including common H.264, HEVC, VP8, VP9 and AV1 material where supported by the product | A maintained corpus with codec, profile and bit-depth metadata |
| Packaging | MP4, HLS, MPEG-TS, WebM, Ogg and FLV paths used by the client | Validate manifests, segments, timestamps and playback |
| Images and software filters | JPEG extraction, scaling, cropping, pixel conversion and supporting filters used by imports and previews | Exercise import images and live segment preview extraction |
| I/O and networking | File and pipe I/O, TCP and RTMP; retain HTTP and HTTPS where required by supported workflows | Local files, streaming pipes and loopback network fixtures |
| Diagnostics | Matching `ffprobe` plus FFmpeg version, build configuration, license, codec, filter and protocol listings | Capture reports during CI and release qualification |

Keep broad input compatibility for the first release. An aggressively minimized
`--disable-everything` configuration can omit a parser, bitstream filter, demuxer,
or decoder needed by real user media. Optimize size only after the corpus and
feature audit demonstrate that a component is unnecessary.

Explicitly audit helpers such as H.264 Annex B conversion, HLS segment handling,
image encoders, FLV input, timestamp generation, and audio resampling. Verify the
client's existing OGV codec and container combination against intended players;
record any existing compatibility defect separately from the new build work.

### Native acceleration requirements

All rows below implement the all-Yes processing matrix: hardware decoding,
GPU scaling and pixel-format conversion, and hardware H.264 encoding for both
MP4/HLS publishing and HLS live streams. Build each applicable backend into the
MoarTube-owned FFmpeg 9.0.2 artifact and qualify the actual client-generated
commands. A compiled encoder alone does not satisfy these requirements.

| Backend | Compile and packaging requirements | Required application behavior |
| --- | --- | --- |
| NVIDIA on Windows and Linux | Compatible pinned `nv-codec-headers`, CUDA filter compilation through a supported toolchain, NVENC and NVDEC integration | `h264_nvenc`, CUDA decoding, `scale_cuda` with NV12 conversion and even output dimensions, and UUID-based device selection; no CPU frame transfers for H.264 publishing or live scaling |
| AMD on Windows | Pinned AMF headers, Windows graphics interfaces, Direct3D 11 decoding, `vpp_amf` and `h264_amf` enabled in FFmpeg 9.0.2; verify AMF hardware-frame interop | Direct3D 11 hardware decode -> `vpp_amf` GPU scaling/NV12 conversion -> `h264_amf`, on the selected adapter for publishing and live streams; no CPU scaling, cropping or frame transfers |
| Intel on Windows | Pinned oneVPL development interfaces, compatible runtime closure, Windows Direct3D 11 interfaces, QSV decoding, `vpp_qsv` and `h264_qsv` | QSV hardware decode -> `vpp_qsv` GPU scaling/NV12 conversion -> `h264_qsv`, with the hardware session bound to the selected DirectX adapter for publishing and live streams |
| AMD and Intel on Linux | VA-API and DRM development interfaces, VA-API decoding, `scale_vaapi`, `h264_vaapi`, and the required runtime library closure | VA-API hardware decode -> `scale_vaapi` GPU scaling/NV12 conversion -> `h264_vaapi`, using the selected `/dev/dri/renderD*` node throughout publishing and live streams; qualify AMD and Intel separately |
| macOS Intel and Apple Silicon | Pinned Apple SDK and deployment targets, VideoToolbox decoding, `scale_vt` and `h264_videotoolbox` in both architecture-specific FFmpeg 9.0.2 builds | VideoToolbox hardware decode -> `scale_vt` GPU scaling -> `h264_videotoolbox` for publishing and live streams, with hardware encoding required (`-allow_sw 0`); macOS chooses the hardware |

Keep frames in the backend's hardware surfaces between stages. For Windows AMD,
explicitly request hardware decoder output and validate the Direct3D 11/AMF
filter/encoder surface handoff on the selected adapter. Select and test a
hardware output surface format for `vpp_amf`; setting a software pixel format or
merely removing explicit `hwdownload` arguments is not proof that frames remain
in hardware. Hardware-to-hardware interop and device-local copies are acceptable;
CPU frame downloads, CPU scaling/cropping and reuploads are not.

Use the same backend filter/device configuration for the startup capability
probe, publishing and live streaming. Each must apply the requested resolution,
calculate even portrait/landscape dimensions in the GPU filter, and require
hardware H.264 encoding. Report unsupported inputs and device failures rather
than silently inserting CPU processing into an advertised hardware pipeline.
Explicit CPU mode remains available.

Current status differs from these release requirements: NVIDIA's GPU-only
publishing and live-scaling paths are implemented and hardware-tested on Windows.
Windows AMD now has GPU scaling in publishing, live and probing, with current-host
execution tests passing against the patched MoarTube candidate. QSV,
Linux VA-API and macOS VideoToolbox paths are implemented, with Intel, Linux and
macOS hardware qualification still pending. Full Windows AMD release qualification
extends beyond these short pipeline and loopback RTMP tests.

On macOS, expose the OS-managed VideoToolbox backend rather than promising
physical AMD, Intel or NVIDIA GPU selection. A Mac containing an NVIDIA GPU is
not automatically excluded from VideoToolbox acceleration on other available
hardware, but there is no direct NVIDIA CUDA/NVENC backend on macOS in this plan.

For NVIDIA, prefer investigating the CUDA LLVM route already used by the working
Windows reference. Validate its compiler and header requirements rather than
copying an unrelated CUDA build command. Pinning headers is important because
SDK API requirements can change between FFmpeg releases.

For macOS, FFmpeg 6.0 predates `scale_vt`; FFmpeg 6.1.1 includes it. Use the
selected FFmpeg 9.0.2 baseline for the new distributions and verify the exact
revision. Do not choose an old release solely because it first introduced a
required feature.

Software codec libraries can be linked statically where practical. OS graphics
frameworks and GPU driver interfaces still depend on the host environment.
"Portable" must mean a tested runtime dependency policy, not a promise that GPU
processing has no system dependencies. Do not package GPU driver installers.

## Repository and artifact design

Recommended structure within the existing client repository:

```text
MoarTube-Client/
  package.json
  src/
  tests/
  tooling/
    ffmpeg/
      README.md
      sources.lock.json
      artifacts.lock.json
      targets.json
      features/
        common.json
        nvenc.json
        amf.json
        qsv.json
        vaapi.json
        videotoolbox.json
      scripts/
        fetch-sources
        build-dependencies
        configure-ffmpeg
        build-ffmpeg
        verify-features
        inspect-dependencies
        package-release
      platforms/
        windows/
        linux/
        macos/
      tests/
        fixtures/
        software/
        hardware/
      patches/
      licenses/
  docs/
    ffmpeg-distribution-plan.md
    gpu-acceleration.md
  .github/
    workflows/
      ffmpeg-build.yml
      ffmpeg-hardware.yml
      release.yml
      e2e.yml
  build/
    ffmpeg/
      cache/
      work/
      artifacts/
```

The names above describe responsibilities, not a required scripting language.
Choose one orchestration approach and keep platform-specific compiler commands
small. Each dependency definition should identify its upstream source, exact
revision, checksum, applied patches, build options, license, and consumers.

The existing application directories and `e2e.yml` remain in place. The other
paths and workflow names above are proposed additions. Keep recipes, locks,
small fixtures, patches, and documentation in Git. Ignore downloaded archives,
compiler outputs, caches, generated source trees, and packaged binaries under
`build/ffmpeg`; publish distributable binaries as release assets rather than
committing them to the source tree.

Expose the tooling through root `package.json` commands so maintainers can build
and verify FFmpeg from the same checkout used for the client. Proposed commands
include `build:ffmpeg`, `verify:ffmpeg`, and `build:desktop`; these names do not
represent scripts that already exist. The desktop build should resolve the
pinned target artifact, build it or retrieve a verified matching CI artifact,
verify its manifest and hashes, build the client, and package Electron. Reuse
valid cached outputs instead of recompiling FFmpeg for every UI development run.

Track approved artifact identities in `tooling/ffmpeg/artifacts.lock.json`.
Record both the client repository commit containing the recipe and the source
lock identity in every artifact manifest. Changes to FFmpeg options, application
arguments, and tests can then travel in the same pull request. If a recipe changes,
build and test its new candidate with that client revision before advancing the
approved artifact lock. No cross-repository synchronization is required.

Use upstream source releases or immutable commits. Verify downloads before
extracting or building. Do not follow floating branches or unverified "latest"
URLs during a release build. Audit reused third-party build scripts and preserve
their license obligations when adapting them.

Publish one archive per target with `ffmpeg`, `ffprobe`, any necessary bundled
runtime libraries, license notices, and a manifest. Use a naming convention such
as `moartube-ffmpeg-9.0.2-mt.<revision>-<target>` for the selected upstream
baseline. Track MoarTube recipe revisions separately from the upstream version.

Publish through MoarTube-Client's release workflows and repository release assets.
An application release must identify the exact FFmpeg artifacts it includes.
The FFmpeg artifact revision can remain unchanged across client releases when
its recipe and dependencies have not changed; the shared repository still owns
its source, evidence, publication, and consumption.

The manifest should record:

- Upstream FFmpeg version and commit, MoarTube recipe revision, and target.
- Compiler, linker, SDK, toolchain and build-image identities.
- Minimum OS and CPU requirements, complete configure arguments, and patches.
- Dependency versions, source hashes, binary hashes, and license identifiers.
- Expected codecs, filters, protocols, and backend support.
- Software and hardware test results, including the distinction between compiled
  support, tested hardware, untested hardware, and unsupported combinations.
- Provenance and signature references, source archive location, and build date.

Preserve executability and archive permissions on Unix. Inspect ELF dependencies
on Linux, PE imports on Windows, and Mach-O load paths and architecture on macOS.
Eliminate references to developer workspaces, temporary build prefixes, and
unbundled development libraries.

## Build and CI architecture

Build release candidates from reviewed client-repository commits with pinned
dependencies. Build jobs should have read-only repository permissions and no release or signing
credentials. Use a separate publishing job after verification; untrusted pull
requests must not gain access to signing keys or privileged hardware runners.

Windows builds should use a pinned, documented toolchain capable of the existing
FFmpeg and AMF/CUDA feature set. macOS builds should use appropriate Apple SDKs
and deployment targets for Intel and Apple Silicon. Linux builds should use a
pinned userspace image matching the supported glibc baseline. Containers may be
used internally for reproducible Linux compilation without becoming a user
deployment requirement.

Cache dependency builds using keys that include target, source hashes, compiler,
build flags, and patch identities. Cache misses must rebuild successfully. Caches
are performance aids and must not become the only source of release inputs.

Start with repeatable, recorded builds. Verify source and toolchain consistency,
then investigate differences between independent builds. Do not claim bit-for-bit
reproducibility until timestamp, archive ordering, path embedding, and signing
differences have been addressed and independently compared. Record unsigned
artifact hashes separately from signed and notarized package hashes.

Hosted runners can compile and execute CPU tests. Dedicated hardware runners
must qualify GPU behavior. Keep the existing Client-Node integration workflow's
requirement for a separately prepared real MoarTube Node; the build workflow must
not silently provision or reset that Node.

## Verification and release acceptance

### Build and software checks

For each target, collect `-version`, `-buildconf`, `-L`, `-encoders`, `-decoders`,
`-hwaccels`, `-filters`, `-formats`, `-bsfs` and `-protocols` reports. Compare
required features to the specification and fail on omissions. Inspect runtime
dependencies and test execution on a clean machine or baseline image.

Run CPU import, image extraction, publishing, recording and preview cases. Cover
video-only, audio-only where supported, multiple audio layouts, portrait, square,
landscape, odd dimensions, variable frame rate, long duration, and truncated or
invalid inputs. Include representative H.264, HEVC, VP9 and AV1 inputs without
implying that every GPU can decode them.

Validate outputs with matching FFprobe and decode tests. Check actual codecs,
dimensions, duration, audio, timestamps, keyframes, MP4 playback and seeking,
HLS manifest references, segment existence and decoding, and progressive image
generation. Add user-facing errors for failed processes if the audit exposes a
path that currently treats an FFmpeg failure as success.

### Hardware checks

The current compressed H.264 probe uses a representative 720p input and 360p
output. Keep meaningful sizes; tiny frames can fall below a GPU's encoder minimum.
Use the current probe as a startup check, then perform longer release tests with
real motion, audio and representative user media.

Qualify Windows NVIDIA, AMD and Intel, Linux NVIDIA, AMD and Intel, macOS Intel, and Apple
Silicon independently. An explicitly requested backend must fail qualification
when absent; another available GPU must not satisfy that test. Record hardware,
OS, driver and runtime versions as test context without managing driver installs.

For each backend, test the application's actual MP4 and HLS publishing commands,
RTMP ingestion and live HLS delivery, supported output resolutions, portrait and
odd dimensions, device selection, cancellation, concurrent jobs, session limits,
process cleanup, and application exit. Test unsupported source profiles and bit
depths to verify errors are understandable and do not silently misrepresent CPU
processing as hardware acceleration.

Require every processing column in the desired native matrix to pass on each
qualified backend. Verify the actual filter graph and hardware-frame formats;
successful output or low CPU usage alone does not prove GPU-only video scaling.
Reject qualification if publishing or live scaling uses CPU filters or transfers
video frames through system memory between hardware stages. Hardware-to-hardware
interop must be validated on the selected adapter.

The opt-in hardware tests verify published MP4/HLS and locally fed live commands.
The Windows live hardware test additionally exercises a real loopback RTMP session
through the client's decoder, scaler, encoder and HLS arguments. Neither test
exercises a real MoarTube Node. Complete that delivery-stack coverage before
treating the full streaming workflow as qualified.

### Performance and compatibility checks

Compare representative jobs with the current known-working binary on the same
host. Record throughput, latency, peak memory, CPU usage, output size, playback,
and an appropriate quality assessment. Capture cold and warm startup behavior.
Do not expect identical output bytes from different hardware encoders or versions.

Publish known codec, profile, resolution and concurrency constraints. Validate
the oldest supported OS and CPU baselines rather than testing only current
developer machines. Define acceptable regressions after collecting the baseline;
do not invent performance guarantees before measurement.

A release is accepted only when required target builds, software tests, expected
hardware tests, source and license materials, dependency inspection, and artifact
verification pass. If a hardware target is untested, mark it accordingly and do
not advertise it as certified. Skipped tests are not passing evidence.

## Client and Electron integration

Linux x64 FFmpeg compilation is now implemented using a pinned Ubuntu 24.04
container, with software/feature validation on Ubuntu 24.04 and 26.04 runtime
containers. It exports runtime and separate corresponding-source archives.
Native Linux GPU and desktop qualification remain pending. See the
[Linux build guide](linux-ffmpeg.md) and [validation record](linux-ffmpeg-validation.md).

The initial Windows x64 Electron option is implemented: it runs the backend in a
managed utility process, opens the local UI after readiness, bundles FFmpeg outside
ASAR, and stores settings/media outside the installation. Local unsigned NSIS
installer and standalone ZIP builds are available. Linux x64 now also produces
Ubuntu DEB and standalone archives; see the [Linux desktop guide](electron-linux.md).
macOS desktop packages, signing, auto-update and clean-host installation/upgrade qualification remain
follow-up work. See the [Windows desktop guide](electron-windows.md).

Introduce the MoarTube artifact through `FfmpegService` so import, publishing,
streaming and preview extraction all use the same resolver. Current precedence:

1. An explicit user `ffmpegPath` override.
2. An explicit `FFMPEG_BIN` environment override.
3. The local compilation for this OS and process architecture under
   `build/ffmpeg/install/<target>/bin`.
4. The packaged MoarTube executable for this OS and process architecture.

Electron uses its installed resource directory instead of a local build directory.
If no matching binaries exist, startup throws an error instructing the developer
to compile FFmpeg first. A partial local build also fails instead of silently
selecting an older staged artifact. There is no automatic PATH fallback.

An invalid explicit override should produce an actionable error rather than
silently choosing another executable. Record the effective path and build
identity. Keep capability results tied to the selected executable and invalidate
cached results when it changes.

The user selected mandatory developer compilation instead of retaining the npm
binary fallback. Its dependency and test imports are removed, so npm installation
does not download a second FFmpeg binary. Packaged installations must deliver
their matching verified resource artifact. Preserve the remaining installation
and runtime acceptance gates before publishing new distributions.

Decide whether CLI users receive artifacts through platform-specific npm packages
or a checksum-verified installer. Electron should bundle the verified archive at
build time, allowing first launch without a network download. Pin the client to a
specific MoarTube artifact revision rather than fetching the latest release.

Place executable resources outside Electron's ASAR archive because the client
uses `spawn`. Resolve the installed resource directory explicitly. Separate
read-only executables and web assets from writable settings, media and scratch
directories; the current source-checkout path heuristic is not sufficient for an
installed Electron application. Preserve existing user data during migration.

The Electron application should run the backend in a managed process, open the
existing web UI after readiness, and coordinate shutdown with FFmpeg jobs. Define
whether closing a window leaves jobs running and make explicit Quit behavior
clear. Keep the local UI isolated from privileged Node APIs. Those shell changes
are a separate implementation workstream after FFmpeg integration.

Code-sign applicable Windows and macOS executables and sign/notarize the final
macOS application, including nested executable resources. Resolve required
entitlements from tested behavior. Verify the installed package on a clean host;
successful execution from the development checkout does not prove installed
resource paths, signing, permissions, or library loading work.

Install updates atomically and pin running jobs to their starting executable.
Replace or remove a version only after its jobs have finished. Keep a documented
way to restore the previous artifact and application version without deleting
user settings or media.

## Redistribution and provenance

Choose a redistributable dependency set before committing build options. The
current software H.264 requirement uses `libx264`, which requires a GPL-enabled
FFmpeg build. Avoid `--enable-nonfree` configurations for public distributions.
Review the exact combined dependency licenses and redistribution conditions;
successful compilation is not evidence of distribution rights.

Provide corresponding source for shipped components as required, applied patches,
build instructions, license notices and attribution with each release. Maintain
an inventory or software bill of materials tying binary files to source versions.
Do not assume invoking a separate executable resolves every application packaging
or codec patent question; obtain appropriate review of the actual distribution.

Attach checksums and verifiable provenance to artifacts. Verify hashes before
Electron packaging or CLI installation. Keep signing and release credentials out
of source trees and ordinary build jobs. Document how compromised artifacts or
credentials are revoked and replaced.

## Implementation phases

| Phase | Work and deliverables | Acceptance criterion |
| --- | --- | --- |
| 1 Requirements and baseline | Audit client commands and dependencies; select upstream revision, initial targets, support minimums, corpus, and license policy | Reviewed feature specification and target policy; known-working reference results retained |
| 2 Build foundation | Add FFmpeg tooling to MoarTube-Client, locked sources, verified downloads, dependency recipes, root npm commands and manifests | One clean CPU build per initial target passes inspection and representative software tests |
| 3 Native acceleration | Add NVIDIA, AMF, QSV, VA-API and VideoToolbox configurations and checks | Required compiled features present; backend-specific transcode probes pass on suitable hosts |
| 4 Qualification and release packaging | Extend software and hardware tests; inspect runtime dependencies; package sources, notices, hashes and provenance | Candidate satisfies release acceptance for each advertised target |
| 5 Client integration | Add packaged resolver, build diagnostics, override tests and CLI migration strategy | Actual import, publishing and live workflows use the pinned artifact and preserve user data |
| 6 Electron packaging | Add desktop lifecycle, resource layout, installers, signing, notarization, update and rollback handling | Clean-host installation, offline first launch, processing, updating and rollback pass |
| 7 Operational handover | Publish runbooks, assign maintainers, establish update and incident procedures, record measured cost | A second maintainer can rebuild and qualify a release from the recorded inputs |

These phases are proposed work, not completed implementation. Phase 3 depends on
the platform build foundation and available hardware; Phase 6 depends on stable
artifact consumption. Prototype the desktop shell in parallel only if it does not
delay build qualification. Do not attach calendar commitments until runner access
and initial cold-build timings are known.

## Ownership and operating cost

Assign an engineering owner for build recipes and dependencies, an application
owner for command compatibility and resolver integration, and a release owner for
signing, artifact publication and rollback. One maintainer may fill several roles,
but record responsibilities and establish a backup maintainer before relying on
the pipeline for public releases.

Budget for Windows, Linux and macOS CI minutes; CPU and hardware runner capacity;
source and binary storage; artifact bandwidth; signing/notarization accounts or
services; and maintenance time. Hardware testing requires actual suitable AMD,
NVIDIA, Intel Windows/Linux, Intel Mac and Apple Silicon systems, whether dedicated or shared. The
existing Windows machine may cover both AMD and NVIDIA tests, subject to runner
availability and isolation.

Measure cold and cached build duration, archive size, source-storage growth,
hardware-test duration and failed-build frequency during the prototype. Use those
measurements and the chosen provider's current rates to estimate ongoing cost.
The largest scheduling uncertainty is typically access to the required hardware
and time to resolve platform toolchain or runtime dependency problems.

## Maintenance and rollback procedure

Check upstream FFmpeg and dependency security and maintenance releases on a
regular cadence, and expedite relevant security fixes. Assign responsibility
for monitoring; a version pin does not remove the need to update vulnerable media
parsers. Build routine updates as candidates and run the full applicable test
suite before promotion.

For each update, change locked sources deliberately, review license and toolchain
changes, rebuild targets, compare feature reports and behavior, perform hardware
qualification, and publish an immutable artifact revision. Update the client to
that exact revision only after acceptance. Archive the evidence and keep the
previous known-working revision available under the retention policy.

On a regression, stop promotion, restore the previous pinned artifact, and record
affected targets and workflows. Distinguish a recipe problem, upstream behavior
change, application argument incompatibility, and host-specific capability
failure. Fix and requalify with a new revision; never overwrite an existing
published artifact under the same identity.

## Risks and planned responses

| Risk | Planned response |
| --- | --- |
| A target builds but acceleration is unavailable | Require both feature reports and execution on the expected backend |
| A clean installation lacks a linked library | Inspect dependency closure and run clean-host installation tests |
| Input compatibility shrinks after minimization | Preserve broad decoding initially and maintain a representative corpus |
| Upstream changes an FFmpeg option or encoder behavior | Exercise actual client-generated commands before promoting the artifact |
| Build-machine tuning excludes older CPUs or Linux systems | Define minimum baselines, avoid native tuning and test those baselines |
| GPU minimum dimensions, profiles or session limits are exceeded | Record qualified capabilities, test failure paths and retain explicit CPU selection |
| An update interrupts active jobs | Keep running jobs on their starting artifact and defer replacement or cleanup |
| Release credentials or dependencies are compromised | Isolate publication, verify sources and artifacts, and retain provenance and incident instructions |
| A target lacks accessible qualification hardware | Keep its status explicit and delay certification until a real test can run |
| Redistribution terms are incompatible | Resolve the dependency and licensing policy before publishing binaries |

## Decisions to record before implementation

- Confirm the FFmpeg tooling layout within MoarTube-Client and identify maintainers and release authority.
- Lock the selected FFmpeg 9.0.2 source revision and checksum, and select compatible dependency versions.
- Confirm initial target coverage, especially Linux ARM64 and any legacy ARM32 users.
- Set minimum OS, CPU and Linux userspace requirements consistent with Electron.
- Decide the Linux runtime library policy and the matching portable package layout.
- Choose release hosting, signing and provenance mechanisms, and source retention.
- Confirm CLI distribution alongside Electron and the migration away from `ffmpeg-static`.
- Secure access to hardware qualification systems and define the release evidence required.

The recommended defaults are one cohesive MoarTube-Client repository, pinned upstream sources,
portable target-specific archives, a GPL-compatible feature set supporting the
current CPU codecs, Electron-bundled artifacts, explicit user overrides, and
hardware qualification before acceleration is advertised for a target.

## Completion criteria

The project is complete when another maintainer can build the supported artifacts
from recorded sources; each advertised target passes its software and hardware
acceptance tests; the client and Electron packages consume a pinned verified
artifact; installations and updates preserve user data; required source and
license materials accompany releases; and maintenance and rollback procedures
have been demonstrated.

## References

These sources support the architecture and dependency requirements. Recheck the
selected upstream revision and license texts when implementing the recipes.

- [FFmpeg static binary download selection](https://github.com/eugeneware/ffmpeg-static/blob/master/install.js)
- [FFmpeg static upstream binary collection script](https://github.com/eugeneware/ffmpeg-static/blob/master/download-binaries/index.sh)
- [FFmpeg 6.1.1 configuration and feature dependencies](https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/configure)
- [FFmpeg 6.0 configuration](https://github.com/FFmpeg/FFmpeg/blob/n6.0/configure)
- [NVIDIA codec headers](https://github.com/FFmpeg/nv-codec-headers)
- [FFmpeg external library integration](https://ffmpeg.org/general.html)
- [FFmpeg licensing and redistribution](https://ffmpeg.org/legal.html)
- [Gyan Windows build configuration](https://www.gyan.dev/ffmpeg/builds/)
- [John Van Sickle Linux build information](https://johnvansickle.com/ffmpeg/release-readme.txt)
- [Evermeet Intel macOS builds](https://evermeet.cx/ffmpeg/)
- [OSXExperts macOS compilation walkthrough](https://osxexperts.net/)
- [Electron executable archive constraints](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Electron utility processes](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron distribution and signing](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
- [Existing client GPU implementation and test guidance](gpu-acceleration.md)
