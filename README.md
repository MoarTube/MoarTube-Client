<img src="https://github.com/MoarTube/MoarTube-Client/assets/26640616/539be602-3608-428d-b6d6-34aec9b4a05d" alt="logo" width="200"/>

# **MoarTube-Client**
Welcome to **MoarTube Client**, the client-side software for managing your own videos and live streams! This cross-platform, terminal-based Node.js Express application is for managing your [MoarTube Node](https://github.com/MoarTube/MoarTube-Node).


[TL;DR: Watch the Quickstart Video](https://www.moartube.com/guides/moartube-quick-start)

# 🚀 **How to Get Started**
Welcome to the **MoarTube Client setup guide**! Follow these simple steps to get your MoarTube Client up and running. Don’t worry—MoarTube is designed to be so easy to set up and use, you’ll be done in minutes.

When you’re ready, make sure to check out the [MoarTube Node](https://github.com/MoarTube/MoarTube-Node) if you haven’t already.

## Table of Contents
- [Features](#features)
- [System Requirements](#system-requirements-lightweight-flexible-and-powerful)
- [Prerequisites](#prerequisites)
  - [npm](#npm)
  - [git](#git)
- [Installation Methods](#installation-methods)
  - [npm](#npm-1)
  - [git](#git-1)
- [Next Steps](#next-steps)
  - [Open the MoarTube Client](#open-the-moartube-client)
  - [Default Login Credentials](#default-login-credentials)
  - [Get MoarTube Node](#get-moartube-node)

## Build Electron apps for all platforms

Run **Electron builds - all platforms** in GitHub Actions to build and verify
Windows x64, Linux x64/ARM64, and macOS Intel/Apple Silicon together. Leave
`release_tag` empty to download workflow artifacts, or supply an existing draft
release tag to upload verified downloads to that draft. The workflow never
publishes a release. See [the desktop build guide](docs/electron-builds.md)
for local commands, outputs, and signing limitations.

## Windows desktop option

See [the build output layout](docs/build-outputs.md) for release downloads,
compiler workspaces, caches and validation evidence on both platforms.
See [build preparation and caching](docs/build-preparation-and-caching.md) for
dependency preflight and reuse of verified FFmpeg builds in GitHub Actions.

Windows 11 x64 has two Electron distributions. Both include FFmpeg/FFprobe and
require no Node.js installation on the user's computer.

| Variant | Windows build command | Behavior |
| --- | --- | --- |
| Client | `npm.cmd run desktop:build:windows:client` | Normal login and Node selection; connect to a Node managed separately. |
| Client + Node | `npm.cmd run desktop:build:windows:client-node` | Includes Node.js and Cloudflared; automatic sign-in by default. Set credentials in Settings to require sign-in on next start, or save both fields blank to restore automatic sign-in. Always connects to its own Node. Closing hides to tray; Quit MoarTube stops both. |
| Both | `npm.cmd run desktop:build:windows:all` | Builds installers and ZIPs for both variants. |

Downloads share `build/desktop/releases/win32-x64/1.1.0`. Client filenames
start with `MoarTube-Client-`; bundled filenames start with `MoarTube-Client-Node-`.
Portable ZIP filenames end in `-windows-x64-portable.zip`; setup installers end
in `-windows-x64-setup.exe`.
Both setup executables use ZIP/Deflate payloads for faster extraction and
distribute full installers for upgrades.
The NSIS build generates an override of the installed builder's file-copy
template to skip caching a second full setup executable. The installed
uninstaller handles removal and full-installer upgrades.
Windows setup offers installation for **Just me** (selected by default on a fresh
installation) or **All users**. Just me uses `%LOCALAPPDATA%\Programs`; All users
requests administrator permission and uses Program Files. Upgrades retain the
existing installation scope. Settings and media remain per-user in both modes.
Each variant has its own installer identity and shortcut, so both can coexist.
Packaged application folders are under
`build/desktop/work/win32-x64/packages/client/win-unpacked` and
`build/desktop/work/win32-x64/packages/bundled/win-unpacked`.
Run `npm.cmd run desktop:verify:windows:all` to verify both packaged apps.
Use `desktop:verify:windows:client` or `desktop:verify:windows:client-node` to
verify one variant from its build/pack output. The bundle check also verifies
share playback. A missing packaged executable produces an error; these commands
do not fall back to a development launch. For a different executable location,
append `-- "<path-to-executable>"` to the single-variant command.
Both Electron variants enable **Autostart** and **Minimize on Close** by default.
Client and Node Settings each offer **Allow connections from other computers**.
The Client defaults to local connections in every distribution. The bundled Node
also defaults to local connections; a standalone Node defaults to network access.
Disabled listens on `127.0.0.1`; enabled listens on `0.0.0.0`. Choices are saved
independently and apply after restarting the respective component. Cloudflare
Tunnel works with Node network access disabled. Enabling network access may
trigger a firewall prompt. The Client toggle controls its web interface, not
FFmpeg's separate live-stream input. Browsers accessing a bundled Client over
the network must sign in; automatic admin sign-in remains exclusive to Electron.
Toggle either from the tray's right-click menu or the window's **File** menu;
the controls share the same saved preferences. With Minimize on Close enabled,
closing keeps the app running in the tray (minimized in the taskbar on Linux
so it remains accessible on desktops without status icons). With it disabled,
closing quits the app and stops its managed Client, bundled Node and child
processes. **Quit MoarTube** always quits regardless of this preference.
Automatic launches stay in the tray without showing the
window, including when credentials require sign-in. Opening the app manually
shows its window. Development and automated test profiles do not register
themselves for real system startup.
GitHub Actions has two distinct Windows workflows: **Windows x64 - Client**
and **Windows x64 - Client + Node**. Each builds and verifies only its own
distribution. **Electron builds - all platforms** runs both Windows workflows.

Compile FFmpeg first. Client builds need just the Client checkout.
Bundled builds also need a sibling `MoarTube-Node` checkout with `npm ci` and
`npm run install:cloudflared` completed; set `MOARTUBE_NODE_SOURCE` for another path.
Use `desktop:dev` for Client development and `desktop:dev:client-node` for the bundle.
Use `desktop:pack:windows:client`, `desktop:pack:windows:client-node`, or
`desktop:pack:windows:all` to create unpacked apps.

Windows packages omit dependency source maps, TypeScript declarations, tests,
examples and benchmarks to reduce installer extraction and upgrade work. Runtime
JavaScript, native modules, assets and licenses remain included.

The Windows build commands also consolidate pure JavaScript dependencies into
shared bundles for both variants. Native modules, logging workers and packages
that read their own runtime assets retain their production dependency trees.
Both Windows variants run the Client backend in an Electron utility process.
Linux x64 and ARM64 apply dependency consolidation and content pruning to both
Client and Client + Node. Bundled Node dependencies stay inside ASAR and run through
Electron on both architectures. Both Linux x64 and ARM64 Client backends now use
Electron's embedded Node runtime, and neither variant ships a standalone Node
executable. Client dependencies and shared vendor bundles stay inside ASAR on
both architectures; logging workers, image workers and WASM assets remain unpacked.
The ARM64 host/ASAR migration passed installed and portable qualification in the
full-system Debian Trixie VM, including the packaged WASM/FFmpeg worker and
Chromium kernel sandbox. The current Linux x64 and ARM64 portable archives each
contain 167 regular files for Client and 205 for Client + Node, with no standalone
Node runtime. These are archive file counts, not installation-time benchmarks.
Client images now use FFmpeg for centre-cover resizing, PNG compression and JPEG
encoding. Profiled and CMYK inputs are first converted to sRGB in a persistent
`@imagemagick/magick-wasm@0.0.46` worker; ordinary unprofiled 8-bit RGB JPEG/PNG
inputs bypass that conversion. The worker and its WASM asset are installed as a
small set of real files, with no native image addon or Electron ABI dependency.
Pinned profiles and their provenance are in `src/utils/image-runtime/profiles`.
Uploads retain the 20 MiB / 40 megapixel limits; decoding, queued jobs and output
buffers are bounded, and conversion/encoding has timeouts. PNG transparency is
preserved; JPEG is flattened against black. EXIF orientation is ignored and
removed, matching the existing upload policy. JPEG uses FFmpeg q=1 (qmin=1,
4:2:0), a conservative quality preset rather than a numeric equivalent of Sharp
quality 90; generated JPEG files can be larger. Run `npm run test:images` with
staged FFmpeg or an explicit `FFMPEG_BIN` override for fixture-based image tests.
The image migration passed Windows x64 and Linux x64 packaged checks, plus Linux
ARM64 installed/portable image and GUI checks in the full-system Debian Trixie VM.
The macOS image migration still requires fresh native packaged qualification.
Native SQLite libraries, Cloudflared, logging workers and public assets
retain real disk paths and executable permissions. ARM64 optimization builds, package checks and installed/portable GUI tests have
passed in the full-system Debian Trixie VM with Chromium sandboxing enabled.
Physical ARM64 hardware, GPU and Wayland qualification remain separate.
Windows Client + Node also runs the Node primary in a utility process and its
cluster workers through Electron's embedded Node runtime. Node JavaScript and
dependencies are read directly from `resources/node.asar`; the bundle omits the
separate Node executable. The Electron `RunAsNode` fuse must remain enabled for
cluster workers. Native Node-API SQLite, Cloudflared, logging worker entry points
and public assets are unpacked at install time. Build checks exercise SQLite in
Electron before and after packaging and verify the packaged runtime version.
Windows Client JavaScript dependencies and shared bundles are read directly from ASAR;
native libraries, logging worker entry points and public assets use disk paths.
Bundled dependency notices are in `THIRD-PARTY-NOTICES.txt`. Windows Client + Node
installers and ZIPs contain runtime files. Matching Node and Client source,
original manifests/lockfiles, dependency sources and desktop build recipes are a
separate `MoarTube-Client-Node-<version>-windows-x64-<hash>-sources.zip` release
download. The installed `resources/node-SOURCES.txt` records its URL and SHA-256.
The build includes it in checksums and release notes; the Windows draft uploader
requires both this archive and the FFmpeg source archive alongside the binaries.
Source downloads are optional for running the app and are never unpacked at startup.
Audited package versions also omit build/install helpers, declaration-only
dependencies and unused dependency CLIs. Shared runtime dependencies remain
included. `build/desktop/reports/win32-x64/javascript-bundles.json` records each
omitted dependency and its reason; upgraded packages keep their full production
dependencies until audited again.
The Windows bundled Node runtime also shares byte-identical AJV dependencies
after checking their dependency resolution, and consolidates audited YAML and
semver JavaScript behind their runtime entry points. The build report records
these changes; original dependency sources are included in the source download.
Audited runtime copies also omit package documentation, adjacent tests, type-test
folders, duplicate TypeScript sources and native build sources. Compiled schema
validators, JSON schemas, Swagger UI assets, logging workers and native binaries
remain included. License notices are retained even inside excluded folders;
`omittedPackageContents` in the build report records the exclusions.

For manual electron-builder invocations, first run
`node scripts/prepare-desktop-javascript.mjs --variant=client` (or `bundled`, after
preparing the Node resources). The standard Windows build commands do this automatically.

Installed distributions share one per-user application-data root named `MoarTube`:

- Windows: `%APPDATA%/MoarTube`
- macOS: `~/Library/Application Support/MoarTube`
- Linux: `$XDG_DATA_HOME/MoarTube` (default `~/.local/share/MoarTube`)

Standalone Client data is in `client`; standalone Node data is in `node`.
The bundle uses `client_node/client` and `client_node/node` under that same root.
Electron browser profiles, logs and Autostart preferences stay within the
corresponding Client folder's `desktop` subdirectory. Development/test profiles
remain isolated under `build/desktop/profiles`, using the same `MoarTube` layout.

CLI development runs (`npm run dev`, `npm start`, and VS Code launches) use the
source checkout's local `data` folder, including for locks and `--clean`. They do
not inspect or modify the installed application's data. Explicit data-directory
overrides and Docker's `/data/MoarTube/client` location still take precedence.

Startup uses only these data folders. Older folders are never searched or imported;
a missing folder starts with fresh defaults. An active data directory is locked
to one process.
`MOARTUBE_DATA_ROOT` selects a custom shared parent (or a folder already named
`MoarTube`). Existing explicit `MOARTUBE_DATA_DIR` component overrides remain
supported. Explicit custom locations start independently. Installed application
data stays outside the installation directories.
Matching FFmpeg sources accompany the installers. Windows, Linux and macOS
Client + Node builds also have a separate matching application source download;
runtime packages retain license notices and a source archive pointer.
Builds are unsigned candidates.

## Linux desktop option

Linux has separate **Client** and **Client + Node** distributions for x64 and
ARM64, each with its own DEB package, launcher, executable and portable archive.
Portable archives end in `-linux-x64-portable.tar.gz` or
`-linux-arm64-portable.tar.gz`; DEB package names are unchanged.
Both can coexist with each other and the `moartube-client` npm CLI.

| Distribution | Build | Verify installed and portable packages |
| --- | --- | --- |
| Client | `npm run desktop:build:linux:client` | `npm run desktop:verify:linux:client` |
| Client + Node | `npm run desktop:build:linux:client-node` | `npm run desktop:verify:linux:client-node` |
| Both | `npm run desktop:build:linux:all` | `npm run desktop:verify:linux:all` |

Append `-- --arch=arm64` to select ARM64. Builds use the existing Linux build
containers, including when launched from Windows. Installed applications require
neither Docker nor a separately installed Node.js. Compile the matching FFmpeg
candidate first. The bundle also needs a sibling `MoarTube-Node` checkout, or
`MOARTUBE_NODE_SOURCE` pointing to it.

For prepared/offline builds, prepare the Client dependency image first with
`node scripts/prepare-linux-dependencies.mjs --desktop --arch=x64 --downloads-only`,
then the Node image with
`node scripts/prepare-linux-node-dependencies.mjs --arch=x64` while
`MOARTUBE_DEPENDENCIES_PREPARED=1`. Normal builds prepare their images automatically.
Linux x64 and ARM64 DEBs use Zstandard level 3; portable tar.gz uses gzip level 6. The
container builder supplies its compressor from the pinned build Node runtime.
The image WASM dependency uses normal npm installation and caching; its precompiled
asset, license and third-party notices are staged without a native image build.
Linux x64 and ARM64 verify bundled Node-API SQLite and Cloudflared under Electron
before and after packaging. Both Client variants probe the WASM worker and FFmpeg
image outputs after packaging. Cloudflared is checked
against its pinned release digest. Credentials and user data are excluded.
Linux x64 and ARM64 Client + Node ship runtime files and license notices, with matching
application sources and build materials in the optional
`MoarTube-Client-Node-<version>-linux-<arch>-<hash>-sources.zip` release asset.
`resources/node-SOURCES.txt` identifies that archive and its SHA-256. Release
checksums and draft upload checks require it alongside the FFmpeg source archive.

Four separate GitHub workflows cover **Linux x64 / ARM64 — Client / Client + Node**.
The all-platform workflow calls all four. Each contributes only its own binary
pair, checksums and notes to an existing draft release. FFmpeg source archives
remain shared optional downloads. Bundle workflows check out MoarTube Node's
default branch; push the matching Node changes before running CI.
Native runners verify both Ubuntu runtime
images; the ARM64 verifier also checks the configured Debian image. On x64 hosts,
use `npm run desktop:verify:linux:arm64:vm:all` for full-system ARM64
graphical checks rather than relying on user-mode emulation.

Ubuntu 24.04 and 26.04 x64 and ARM64 have Electron DEB and standalone build targets,
with Linux FFmpeg/FFprobe bundled and corresponding sources offered separately.
Install the DEB with your software installer or `sudo apt install ./<download>.deb`,
then launch MoarTube Client from the application menu. The command
`moartube-client-desktop` remains separate from the npm CLI.

Build from Windows/WSL/Linux with `npm run desktop:build:linux:all` after compiling the
Linux FFmpeg candidate. Run `npm run desktop:verify:linux:all` for the container tests.
Downloads land in `build/desktop/releases/linux-x64/1.1.0`. System dependencies
are listed in [runtime-packages.json](desktop/linux/runtime-packages.json).
Native GPU and Wayland qualification remains separate from the software-rendered tests.

For ARM64, use `npm run desktop:build:linux:arm64:all` after
`npm run ffmpeg:build:linux:arm64`, and `npm run desktop:verify:linux:arm64:vm:all`
for full-system Debian Trixie VM validation. Native ARM64 Docker hosts can use
`npm run desktop:verify:linux:arm64:native:all` for Ubuntu and Trixie container tests.
Downloads land in `build/desktop/releases/linux-arm64/1.1.0`.
ARM64 also tests Debian Trixie libraries for Raspberry Pi OS compatibility;
physical Pi desktop/GPU qualification remains separate.

## macOS Intel and Apple Silicon desktop options

Darwin x64 and ARM64 have native FFmpeg and Electron DMG/ZIP build scripts targeting macOS 15+.
Choose **macOS x64 - Client**, **macOS x64 - Client + Node**,
**macOS ARM64 - Client**, or **macOS ARM64 - Client + Node** in GitHub Actions.
Each workflow builds its selected variant's DMG/ZIP candidates and verifies them
on native macOS runners. The all-platform workflow calls all four. Both Darwin
architectures use Electron for the backends, keep JavaScript dependencies in
ASAR, and apply the shared audited dependency pruning and Node consolidation.
The bundle's matching source/build materials are an optional separate download.
ZIP/Deflate and DMG/UDZO default to compression level 6; locales remain included.
Package reports record file counts. These changes await native build and runtime
qualification before claiming installation-time or size improvements.
On an Intel Mac, run `npm run ffmpeg:build:darwin`,
`npm run desktop:build:darwin:all` and `npm run desktop:verify:darwin:all`.
On Apple Silicon, use `npm run ffmpeg:build:darwin:arm64`,
`npm run desktop:build:darwin:arm64:all` and `npm run desktop:verify:darwin:arm64:all`.
Reverify existing FFmpeg candidates without rebuilding with
`npm run ffmpeg:verify:darwin` or `npm run ffmpeg:verify:darwin:arm64`
on the matching native Mac. These run feature and software-media checks;
VideoToolbox hardware qualification remains separate.
Both variants await fresh native CI qualification. Initial packages use
ad-hoc signing and are not notarized. See the [macOS guide](docs/electron-darwin.md).

## Compile FFmpeg before starting

The Node.js minimum is **24.22.1**. `.nvmrc` selects that version, and GitHub
workflows and Linux container images pin it exactly for builds and bundled Node
backends. Electron supplies the runtime for desktop utility processes on all
supported platforms.

Linux x64 builds use Ubuntu 24.04 as the baseline and test exported binaries on
Ubuntu 24.04 and 26.04. Run `npm run ffmpeg:build:linux` with Docker's Linux engine
(WSL 2 backend on Windows). See the [Linux FFmpeg guide](docs/linux-ffmpeg.md) for
runtime dependencies, validation and source/runtime archives. Build the Linux
Electron DEB and standalone archives with the variant commands above.

Developers must compile the FFmpeg dependency for their operating system and CPU
architecture. On Windows 11 x64, use native x64 Node.js 24.22.1 or newer and run from
the repository root:

```powershell
npm.cmd install
npm.cmd run ffmpeg:build:windows
npm.cmd run build
npm.cmd start
```

The FFmpeg command downloads and verifies the pinned build tools and sources,
then compiles and checks FFmpeg and FFprobe. The client automatically uses
`build/ffmpeg/install/win32-x64/bin`; no staging step or environment variable is
needed for development. Missing or incomplete builds stop startup with a
compile-first error. The client does not download FFmpeg through npm or fall
back to a system executable on PATH. Installed packages can instead bundle a
verified matching resource artifact. Explicit `ffmpegPath` and `FFMPEG_BIN`
overrides remain available.

FFmpeg recipes target Windows x64, Linux x64, Linux ARM64 and macOS x64. For Linux ARM64,
run `npm run ffmpeg:build:linux:arm64`, then
`npm run ffmpeg:verify:linux:arm64:runtimes` with Docker's Linux engine.
The ARM64 client selects `build/ffmpeg/install/linux-arm64/bin` automatically.
Linux Electron targets both x64 and ARM64. Other targets require their own
native build or an explicit compatible override. See the
[FFmpeg build guide](tooling/ffmpeg/README.md). Media fixture tests use the same
compiled dependency as the client; test runners must prepare it first.

## Clean startup

From a source checkout with development dependencies installed, run
`npm start -- --clean`. This permanently deletes the
client's `data`, `dist`, `playwright-report`, `temp`, and `test-results` directories,
including saved settings and imported videos. Cleanup finishes before the client
is rebuilt and startup provisions fresh data. Missing directories are ignored;
cleanup or build failures stop startup. Paths are relative to the client
installation, regardless of the terminal's working directory.

The CLI also accepts `moartube-client --clean` when running from a source checkout.
Published packages require a source checkout for clean startup because they do not
include the sources and build tools needed to recreate `dist`.

## Development testing

For the complete Windows checks on one local GPU-equipped PC, use
`npm.cmd run test:integration`, or register and start its GitHub Actions runner
with `npm.cmd run test:runner:setup` and `npm.cmd run test:runner`.
See [local integration and GPU testing](docs/local-integration-runner.md) for
registration, dependencies, hardware assertions and report locations.

The client includes Playwright tests spanning Client administration and Node viewer
workflows, including playback, comments, reports, moderation and live chat
against a real MoarTube Node that the developer must already have running at
`http://localhost:9090`. The suite errors out if it is unavailable and never
prepares, starts, resets or substitutes the Node.
Run `npm run test:e2e:install` once, then `npm run test:e2e` for Chromium or
`npm run test:e2e:all` for Chromium, Firefox and WebKit. Tests are also available
in the VS Code Playwright extension. See [the E2E guide](tests/e2e/README.md)
for prerequisites, coverage, debugging and integration-test limits.

# Features

## 🖥️ Platform Support
- Cross-platform compatibility: **Windows**, **macOS**, and **Linux**
- Capable of running on a **[Raspberry Pi Zero 2 W](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/)**
- Run your node **Privately** or **publicize** your videos and streams on [MoarTube](http://www.moartube.com)
- MoarTube Client performs **video and stream processing** on your local machine
- MoarTube Node handles **storage and distribution** of your content
- Host your node:
  - **In the cloud**
  - **On your home WiFi**

## 📹 Video & Streaming Features
- **Video on Demand (VoD)** and **HLS Live Streaming**
- Supported formats:
  - **HLS** *(H.264, AAC)*
  - **MP4** *(H.264, AAC)*
  - **WEBM** *(VP9, Opus)*
  - **OGV** *(VP8, Opus)*
- Transcoding capabilities:
  - Convert **MP4/WEBM** videos to **HLS/MP4/WEBM/OGV**
  - Transcode **RTMP streams** ([e.g., from OBS](https://www.moartube.com/guides/how-to-live-stream-obs)) into **HLS live streams**
- Video resolutions: **2160p**, **1440p**, **1080p**, **720p**, **480p**, **360p**, **240p**
- Video player modes:
  - **Streamer Mode**
  - **Theater Mode**
  - **Fullscreen Mode**
- **Anonymous Comments & Live Stream Chat**:
  - Foster engagement while maintaining user privacy

## 💾 Data Processing, Storage, Distribution
- Processing
  - **CPU** and **GPU** support
  - Nvidia, AMD and Intel on Windows/Linux, VideoToolbox on native macOS
    - Requires a compatible FFmpeg build and available hardware acceleration
- Storage
  - Local database storage using **SQLite**
  - Decentralize your node with a remote **Postgres** database
  - **File system** to store your videos and live streams locally on your node
  - **S3-compatible provider** to store your videos and live streams in the cloud
    - Amazon Web Services (AWS), DigitalOcean Spaces, Minio, etc...
    - **path-style** and **vhost-style** URL compatibility
- Distribution
  - Leverage Cloudflare's CDN for global content distribution

## ⚙️ Admin & Moderation
- **Admin Panel**
  - Managing videos and live streams
- **Reports Section**:
  - Track and moderate comments and videos
- **Comment Monitoring Overview**:
  - Includes moderation tools

## 💵 Monetization & Promotion
- Monetization via cryptocurrency:
  - Accept **ETH** and **BNB** via MetaMask
  - Provide **wallet addresses** to your viewers for donations
- Promote your node by providing links to:
  - **Social media platforms**
  - **Websites**
  - **External platforms**

## 🛠️ Advanced Features
- [**Cloudflare CDN**](https://www.moartube.com/guides/how-to-enable-cloudflare-cdn):
  - The enabling modal asks for your Cloudflare email, zone ID, and global API key. Node generates and saves a `moartube-<UUID>` tunnel name automatically; no tunnel name needs to be entered.
  - Enabling CDN uses HTTPS on port 443 and the selected zone's root domain. Disabling CDN restores the saved public address. Imports, publishing, streaming, and stream cleanup must be inactive; incomplete migrations must be retried before new jobs can start.
  - Incomplete CDN transitions show a persistent status panel in Settings. Retry setup/removal resumes the saved configuration without asking for credentials again; the panel disappears after recovery succeeds.
  - Cloudflare's **global network** facilitates mass data propagation for audiences of any size, anywhere.
  - Data is transmitted throughout Cloudflare's **global network** within milliseconds of beng requested.
  - Available to a free-tier Cloudflare account.
- [**Cloudflare Turnstile**](https://www.moartube.com/guides/how-to-enable-cloudflare-turnstile):
  - Next-generation **bot detection** and **human verification** without intrusive captchas.
  - Available to a free-tier Cloudflare account.
- [**Postgres**](https://www.moartube.com/guides/how-to-configure-database)
  - Remote database storage for video and live stream metadata and information.
  - Host your database **anywhere**.
- [**S3 Providers**](https://www.moartube.com/guides/how-to-configure-storage)
  - Remote storage for video and live stream content.
  - Seemingly **unlimited** storage size and can meet **high demand**.
    - cheap and affordable
  - Compatible with any S3 provider that conforms to the AWS S3 specification.
- [**Dual Box Compatibility**](https://www.moartube.com/guides/how-to-dual-box):
  - Broadcast an OBS RTMP stream to a dedicated processing system running the MoarTube Client.
  - Can broadcast to a dedicated processing system over LAN or WAN.
  - No plugins like NDI required.
- [**GPU Acceleration**](https://www.moartube.com/guides/how-to-enable-gpu-acceleration):
  - Supports **Nvidia**, **AMD** and **Intel** GPUs on Windows/Linux and **VideoToolbox** on native macOS; available acceleration depends on the backend. See [GPU acceleration](docs/gpu-acceleration.md).

## 🏆 Why Choose MoarTube?
MoarTube empowers you to take control of your media hosting with privacy, decentralization, and features designed to rival major platforms while remaining lightweight, accessible, and cost-effective, all from a single node.

![image](https://github.com/MoarTube/MoarTube-Client/assets/26640616/0d8ac95f-f68b-4e36-849e-28139b45ce50)

![image](https://github.com/MoarTube/MoarTube-Client/assets/26640616/918aa074-b6e2-49f1-8d14-5c2ed1bcd582)

![image](https://github.com/MoarTube/MoarTube-Client/assets/26640616/068ec86b-a3d8-4285-9b64-4b71f64cce41)

# System Requirements: Lightweight, Flexible, and Powerful
MoarTube is designed to be lightweight and accessible, making it the most resource-efficient self-hosted video and live streaming solution available today.

## 📋 **Efficient and Resourceful**
- **MoarTube Client** handles the intensive computational tasks for **video and live stream decoding/encoding**. This means performance is only limited by the system it runs on.
- Prefer a dedicated setup? MoarTube supports **dual boxing**. You can run the client on a **dedicated system** for optimized performance.

## 🎮 **GPU Acceleration**
- **Accelerate** processing with **Nvidia**, **AMD** and **Intel GPUs** on Windows/Linux and **VideoToolbox** on native macOS. Intel on Windows/Linux, Linux AMD and macOS support hardware decoding, scaling, and encoding. See [GPU setup and requirements](docs/gpu-acceleration.md).
- **GPU acceleration** is disabled by default. Simply toggle it on in the settings if needed.

## 💻 **Requirements**
- **Node.js v20 or later** is required to run the software.

# Prerequisites

Observe the corresponding prerequisite for your installation method.

## npm
If you're using npm to install the software, make sure that [Node.js and npm](https://nodejs.org/en) are installed on your machine.

## git
You can clone the repo, but make sure that [Node.js and npm](https://nodejs.org/en) are installed on your machine.

# Installation Methods

Choose any of the following installation methods.

## [npm](https://www.npmjs.com/package/@moartube/moartube-client)

You can install MoarTube Client globally:

```bash
npm i @moartube/moartube-client -g
```

And run from the command-line globally:

```bash
moartube-client
```

<br>

You can install MoarTube Client locally:

```bash
npm i @moartube/moartube-client
```

And run from the command-line locally:

```bash
node node_modules/@moartube/moartube-client/moartube-client.js
```

### [git](https://github.com/MoarTube/MoarTube-Client)

```bash
git clone https://github.com/MoarTube/MoarTube-Client
```

Open a terminal in the cloned directory and run:

```bash
npm install
```

```bash
npm run ffmpeg:build:windows # Windows 11 x64; compile the matching target on other OSes
npm run build
npm start
```

# Next Steps

## Open the MoarTube Client

Open a web browser at [localhost:8080](http://localhost:8080) to view the MoarTube Client user interface and log into your node.

## Default Login Credentials

The default login credentials for your node are below. Be sure to change these upon logging in.

By default, MoarTube Client listens on port 8080.

**username**: admin<br/>**password**: admin

## Get MoarTube Node

If you haven't already, it's time to get the [MoarTube Node](https://github.com/MoarTube/MoarTube-Node).
