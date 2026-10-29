# macOS Intel desktop candidate

Darwin x64 targets Intel Macs running macOS 15 or newer. The repository includes
FFmpeg compilation, Electron DMG/ZIP packaging and automated verification scripts.
The first native workflow run is still required to establish compilation and GUI
results. Darwin ARM64 remains future work.

## Build from Windows through GitHub Actions

For FFmpeg alone, run **macOS Intel FFmpeg candidate**
(`ffmpeg-build-darwin.yml`). It builds/verifies FFmpeg and FFprobe and uploads
runtime/source archives, checksums and reports without building Electron.
Both Darwin workflows also run on pushes to `project-refactor`.

Push the changes to GitHub, then open **Actions → macOS Intel desktop candidate
→ Run workflow**. The workflow must be on the default branch for its manual
trigger to appear. It builds on `macos-15-intel` and tests the same downloads on
`macos-15-intel` and `macos-26-intel`. Download the candidate and verification
artifacts from the run. A manual desktop run also uploads verified downloads to
the existing draft named by **Draft release tag**, after both OS verification
jobs pass. See [draft releases](draft-releases.md). Nothing is published
automatically. Standard runners
are free for public repositories; private repositories have usage allowances.

Windows/WSL/Docker do not provide a macOS runtime. These commands run on an Intel
Mac or its GitHub runner:

```bash
npm ci
brew install cmake ninja meson nasm pkg-config xz
npm run ffmpeg:build:darwin
npm run desktop:build:darwin
npm run desktop:verify:darwin
```

Install Xcode command line tools first. Use native x64 Node.js 24.22.1 or newer and macOS 15+;
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

The CPU baseline is generic x86-64 and the deployment target is macOS 15.0.
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

Assets under `build/desktop/releases/darwin-x64/<version>/`:

- `MoarTube-Client-<version>-darwin-x64.dmg`
- `MoarTube-Client-<version>-darwin-x64.zip`
- `<FFmpeg-build-id>-sources.tar.xz`
- `SHA256SUMS-darwin-x64.txt`
- `RELEASE-NOTES-darwin-x64.md`

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
profile intact. Development uses `build/desktop/profiles/darwin-x64/development`;
verification uses isolated profiles.

## Verification scope

`desktop:verify:darwin` validates all download checksums, extracts the ZIP, mounts
the DMG read-only, copies its app into an isolated Applications test directory
and detaches the image before launching. It checks signatures, native x64
modules, executable permissions, the OS baseline and unchanged FFmpeg hashes.
The shared standalone Node backend probe checks Sharp/FFmpeg image processing,
real HTTP/IPC shutdown and parent disconnect. Both packaged apps run the GUI
suite for sign-in UI, renderer isolation/sandbox settings, menu paths, preserved
settings/media, single-instance behavior and shutdown, including paths with
spaces/non-ASCII text. Reports/screenshots are retained under
`build/desktop/reports/darwin-x64/` and uploaded even when verification fails.

These tests do not establish browser-download Gatekeeper acceptance, physical
GPU behavior, full Node-connected publishing/live workflows or Apple Silicon
compatibility. Those remain separate qualification work.

References: [GitHub runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[electron-builder v26 macOS](https://www.electron.build/v26/docs/mac/),
[Apple launch approval](https://support.apple.com/102445).
