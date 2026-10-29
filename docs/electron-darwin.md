# macOS Intel and Apple Silicon Electron candidates

Darwin x64 targets Intel Macs; Darwin ARM64 targets Apple Silicon Macs. Both
use macOS 15.0 as their deployment baseline. The repository includes
FFmpeg compilation, Electron DMG/ZIP packaging and automated verification scripts.
The new ARM64 path still needs its first native workflow run to establish
compilation and GUI results. Windows-side tests do not establish Mac execution.

## Build from Windows through GitHub Actions

Choose one architecture's workflow in Actions:

| Target | FFmpeg only | Desktop build and verification |
| --- | --- | --- |
| Intel x64 | `ffmpeg-build-darwin-x64.yml` | `electron-build-darwin-x64.yml` |
| Apple Silicon ARM64 | `ffmpeg-build-darwin-arm64.yml` | `electron-build-darwin-arm64.yml` |

All four are manual-only. Selecting one architecture does not build or wait for
the other. Every workflow filename includes its CPU target. Standalone FFmpeg
workflows upload runtime/source archives, checksums and reports without Electron.

Push the changes to GitHub, then open the selected workflow under Actions and
choose **Run workflow**. The workflow must be on the default branch for its manual
trigger to appear. Intel builds on `macos-15-intel` and verifies the exact desktop
downloads on `macos-15-intel` and `macos-26-intel`. ARM64 builds on `macos-15` and
verifies its exact downloads on `macos-15` and `macos-26`. Verification does not
recompile the app on the newer OS.

A manual desktop run uploads only that architecture's verified downloads to the
existing draft named by **Draft release tag**, after its own build and both OS
verification jobs pass. Run the other architecture separately if wanted, using
the same commit and draft tag. Nothing is published automatically. See
[draft releases](draft-releases.md) and [cache reuse](build-preparation-and-caching.md).

Windows/WSL/Docker do not provide a macOS runtime. Use the following commands on an Intel
Mac or its matching GitHub runner:

```bash
npm ci
brew install cmake ninja meson nasm pkg-config xz
npm run ffmpeg:build:darwin
npm run desktop:build:darwin
npm run desktop:verify:darwin
```

On a native Apple Silicon Mac or ARM64 GitHub runner, use:

```bash
npm ci
brew install cmake ninja meson nasm pkg-config xz
npm run ffmpeg:build:darwin:arm64
npm run desktop:build:darwin:arm64
npm run desktop:verify:darwin:arm64
```

The unsuffixed Darwin commands retain the Intel default; `:arm64` passes the
explicit ARM64 target. Cross-compilation and universal apps are not used. Each
architecture has separate FFmpeg candidates, compiled caches, staging, release
assets and reports; source download archives can be shared.

Install Xcode command line tools first. Use matching native x64 or ARM64 Node.js 24.22.1 or newer and macOS 15+;
Rosetta builds are rejected. Set `MOARTUBE_NODE_LICENSE` to the matching Node
distribution's `LICENSE` if absent from its installation prefix. CI fetches the
license from Node's matching release tag. Verified FFmpeg candidates can be
reused for desktop builds. Recompiling FFmpeg requires fresh work/install output;
preserve candidates/releases and use a fresh checkout for another compilation.

## FFmpeg and packaging

Sources for FFmpeg, x264, libvpx, Opus, dav1d and zlib use the existing SHA-256
lock. Codec libraries are static; Apple system frameworks remain runtime
dependencies. TLS uses Secure Transport. The build checks for VideoToolbox
decode, H.264 encode and `scale_vt` support alongside CPU codecs, filters and
protocols. Existing client publishing/live arguments support VideoToolbox;
actual hardware execution remains unqualified until tested on a suitable Mac.

The CPU baseline is generic x86-64 for Intel and ARMv8-A for Apple Silicon;
the deployment target is macOS 15.0 for both.
libvpx uses `arm64-darwin24-gcc` on Apple Silicon, matching Darwin 24/macOS 15.
Its unversioned `arm64-darwin-gcc` tuple selects the iOS SDK in the locked
libvpx 1.15.2 configure script, producing incompatible iPhoneOS/macOS compiler
flags. Setting `SDKROOT` alone does not override that target-specific selection.
Qualification rejects wrong Mach-O architectures, newer deployment requirements
and FFmpeg dependencies on Homebrew/build-machine paths. Compiler/SDK versions
are recorded, not hermetically pinned; bit-for-bit reproducibility is not claimed.
The shared software media suite must pass before selecting an immutable
candidate. Corresponding sources include the exact upstream archives, licenses,
recipes, provenance and qualification reports. FFmpeg binaries are ad-hoc signed
before hashing; app signing preserves these signatures and manifest hashes.

The Electron app bundles the client, FFmpeg/FFprobe, Sharp and standalone Node.
Linux and macOS backends use Node child IPC; Windows retains its utility process.
The Mac backend owns a process group for forced shutdown of media children when
graceful shutdown times out.

Assets under `build/desktop/releases/darwin-<arch>/<version>/`, where `<arch>` is
`x64` or `arm64`:

- `MoarTube-Client-<version>-darwin-<arch>.dmg`
- `MoarTube-Client-<version>-darwin-<arch>.zip`
- `<FFmpeg-build-id>-sources.tar.xz`
- `SHA256SUMS-darwin-<arch>.txt`
- `RELEASE-NOTES-darwin-<arch>.md`

Publish and retain matching sources/checksums beside app downloads. Users need
no Node.js, npm or separate FFmpeg installation; sources are optional for users.

## Install, signing and storage

Open the DMG and drag **MoarTube Client.app** to Applications, or extract its ZIP
and move the app there. Connect to an existing MoarTube Node. Closing the window
quits the client and its backend/jobs. A MoarTube Node server is not installed.

Candidates are **ad-hoc signed, not Developer ID signed or notarized**. No paid
Apple credentials are needed, but browser downloads can be blocked by Gatekeeper.
Users who trust the app may need to attempt launch, then approve it through
**System Settings → Privacy & Security → Open Anyway**. Managed Macs may restrict
approval. Do not disable system security or Chromium sandboxing. Developer ID
signing and notarization remain future release work.

Installed settings/media/logs live in
`~/Library/Application Support/MoarTube Client/`, with `client/` and `logs/`
subdirectories. The File menu opens these folders. Removing the app leaves its
profile intact. Development uses `build/desktop/profiles/darwin-<arch>/development`;
verification uses isolated profiles.

## Verification scope

`desktop:verify:darwin` (Intel) or `desktop:verify:darwin:arm64` validates all download checksums, extracts the ZIP, mounts
the DMG read-only, copies its app into an isolated Applications test directory
and detaches the image before launching. It checks signatures, matching native architecture
modules, executable permissions, the OS baseline and unchanged FFmpeg hashes.
The shared standalone Node backend probe checks Sharp/FFmpeg image processing,
real HTTP/IPC shutdown and parent disconnect. Both packaged apps run the GUI
suite for sign-in UI, renderer isolation/sandbox settings, menu paths, preserved
settings/media, single-instance behavior and shutdown, including paths with
spaces/non-ASCII text. Reports/screenshots are retained under
`build/desktop/reports/darwin-<arch>/` and uploaded even when verification fails.

These tests do not establish browser-download Gatekeeper acceptance, physical
GPU behavior or full Node-connected publishing/live workflows. Actual ARM64
compilation and GUI results remain pending the first native workflow run;
physical Mac and VideoToolbox qualification remain separate work.

## Packaging-tool cache

The project uses ES modules, while electron-builder's downloaded icon converter
is a CommonJS `.js` program. A configured `ELECTRON_BUILDER_CACHE` inside the
checkout gets its own `package.json` with `type: commonjs`, so cached tools do
not inherit the application's module type. All desktop packaging configurations
and dependency prefetch apply this boundary, including restored caches.

Prefetch also downloads the icon tool before FFmpeg compilation. Dependency
cache keys include the cache helper so this change creates a fresh dependency
cache without requiring manual cache deletion. A local regression reproduced
the original `require is not defined in ES module scope` error, and the actual
downloaded icon converter produced a valid ICNS file after the repair. Native
macOS packaging/signing still needs its next CI run.

References: [GitHub runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[electron-builder v26 macOS](https://www.electron.build/v26/docs/mac/),
[Apple launch approval](https://support.apple.com/102445).
