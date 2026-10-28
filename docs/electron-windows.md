# Windows desktop application

MoarTube Client has an Electron option for Windows 11 x64. The npm/CLI entry
point remains available. Linux x64 has a [separate Ubuntu desktop build](electron-linux.md);
macOS remains planned. The Windows configuration produces Windows x64 artifacts.

## For users

The Windows installer is `MoarTube-Client-<version>-windows-x64-setup.exe`.
A ZIP of the standalone application directory is also produced: extract the
whole ZIP and run `MoarTube Client.exe`. Do not copy only the executable out of
that directory. Neither option requires Node.js, npm, a compiler, a separate
FFmpeg installation, or a first-launch binary download. GPU drivers remain host
prerequisites. Sign in to your existing MoarTube Node from the app's sign-in page.
The desktop app does not install or provision a MoarTube Node.

These first locally built artifacts are unsigned development candidates. Public
releases need Windows signing and independent installation/upgrade qualification;
Windows may show an unknown-publisher/SmartScreen warning for unsigned builds.
No automatic updater or publishing operation is configured.

Closing the window or choosing File > Quit stops the backend and its active
imports, publishing and live streams. Jobs do not continue in the background.
Files already saved remain in the desktop data directory. Reopening the app does
not automatically resume interrupted jobs.

Desktop settings and media live under `%APPDATA%\MoarTube Client\client`.
Logs live under `%APPDATA%\MoarTube Client\logs`. File menu commands open those
folders. Chromium's own browser data lives in the parent application directory.
Uninstalling or replacing the application preserves this user-data directory.
The desktop app does not automatically migrate, overwrite or share the CLI's
checkout data or its npm profile. Back up those profiles before any deliberate
manual migration.

## Develop and build

Use native x64 Node.js 22 or newer on Windows 11, from the repository root:

```powershell
npm.cmd install
npm.cmd run ffmpeg:build:windows
npm.cmd run desktop:dev
```

`desktop:dev` builds the TypeScript backend and launches Electron. It uses the
local FFmpeg compilation and an isolated profile at
`build/desktop/dev-user-data`, so desktop development does not touch the normal
CLI or installed desktop profile.

To build an installer and standalone ZIP:

```powershell
npm.cmd run desktop:dist:windows
```

To create only the unpacked application directory:

```powershell
npm.cmd run desktop:pack:windows
```

Artifacts and `SHA256SUMS.txt` appear in `build/desktop/output`. Build preparation uses the FFmpeg
packager's verified candidate selection, including binary checksums, matching
FFprobe, source archives, patches, notices and qualification evidence. If the
compiled dependency or its verification evidence is missing, run the FFmpeg build
command first. The application bundles the binaries, license texts, notices and
`SOURCES.txt`; complete sources and rebuild materials are a separate ZIP download.
Cached inputs are reused. Packaging never publishes anything or buys/requests
signing credentials. Later signing can be configured through the packaging
toolchain once a release identity and credentials are available.

## GitHub Release assets

`desktop:dist:windows` produces these files in `build/desktop/output`:

- `MoarTube-Client-<version>-windows-x64-setup.exe`
- `MoarTube-Client-<version>-windows-x64.zip`
- `MoarTube-FFmpeg-<build-id>-sources.zip`
- `SHA256SUMS.txt` covering those three downloads
- `RELEASE-NOTES.md`, a release-description template with direct download links

Upload the installer, application ZIP, matching source ZIP and checksums to the
same GitHub Release. Paste the generated release description and review it before
publishing. Normal users need only the installer or application ZIP. Source ZIPs
contain the pinned FFmpeg and dependency archives, AMD patch, build recipes,
license materials, provenance and binary hashes; they contain no FFmpeg executables.
Keep the license texts and source information bundled with the application.

The default release tag is `v<package.json version>` (currently `v1.1.0`). If your
release uses another tag, set it **before building**, because it is embedded in the
application's source-download information:

```powershell
$env:MOARTUBE_RELEASE_TAG = 'your-release-tag'
npm.cmd run desktop:dist:windows
```

Retain each corresponding source archive while its binaries remain available.
The repository's automatic GitHub source ZIP is not a substitute: downloaded
FFmpeg/dependency archives under `build/ffmpeg` are gitignored. The unmodified full
FFmpeg candidate under `build/ffmpeg/artifacts` remains available for verification
and other distribution formats. Desktop preparation rechecks the upstream source
hashes and both binary hashes before splitting it. The Help menu opens license
texts and `SOURCES.txt`, which identifies the exact source asset, URL and SHA-256.

Electron and electron-builder are exact dev-dependency pins. Their binaries and
installer tools may need downloads during development/building. End users need
none of those tools. The NSIS installer is per-user and does not request elevation.

## Runtime architecture

The Electron main process owns one sandboxed BrowserWindow and a separate Node
utility process. That process runs the existing Fastify backend and web UI on a
private `127.0.0.1` ephemeral port. Readiness is delivered over a private process
message port after the listener and startup checks succeed. The window opens the
sign-in route only after that message; it never attaches to an arbitrary existing
service on port 8080. A second desktop launch focuses the existing window.

The renderer has no Node integration, preload bridge, Electron API, or webview.
Context isolation, sandboxing, normal web security, a desktop-specific CSP and
permissions restricted to local clipboard writes remain enabled. Clipboard reads,
camera/microphone, geolocation and other permissions are denied. Navigation stays on the backend origin;
ordinary external HTTP/HTTPS links open in the user's browser. Executable URL
schemes and file links are rejected. The existing templates still need inline
scripts/styles, so the CSP allows those for the local UI.

The backend, templates and production dependencies are packaged in ASAR. Sharp's
native modules/libraries are unpacked. FFmpeg and FFprobe are resources outside
ASAR, selected through an explicit resource root in the utility process. Packaged
startup does not depend on the developer's build directory, PATH, or FFMPEG_BIN.
An explicit ffmpegPath saved in desktop settings remains a user override.

Installed storage paths use an explicit absolute data directory. Desktop startup
preserves existing media outputs instead of running the CLI's legacy adaptive
output cleanup. Normal CLI startup/data layout remains available.

Quit closes config watchers, publishing timers, network agents and sockets, stops
owned FFmpeg processes, and closes the backend. If graceful shutdown stalls,
the Windows main process terminates only its owned utility process tree by PID.
It does not kill other FFmpeg installations or processes by executable name.

## Verification and remaining release work

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run desktop:test
npm.cmd run desktop:smoke
npm.cmd run desktop:smoke -- "build/desktop/output/win-unpacked/MoarTube Client.exe"
```

Smoke tests use workspace-local test profiles, verify the sign-in UI, renderer
isolation, preserved settings/media, single-instance behavior and backend exit on
Quit, and save screenshots/reports under `build/desktop`. They do not install the
application or modify an existing desktop profile. The separately prepared real
MoarTube Node is still required for full sign-in/import/publishing/live end-to-end
qualification; these smoke tests do not provision or replace it.

Before public distribution, qualify the NSIS installation/uninstallation and
upgrade path on clean Windows hosts, review dependency audit findings, finish
Intel hardware testing, configure signing, and define a tested update/rollback
policy. The current signed-update service, auto-update UI, background tray mode,
macOS packages and notarization are not implemented. Linux has separate packaging
and qualification described in the Linux desktop guide.

The design follows Electron's [utility process API](https://www.electronjs.org/docs/latest/api/utility-process),
[security guidance](https://www.electronjs.org/docs/latest/tutorial/security),
and electron-builder's [NSIS configuration](https://www.electron.build/nsis/).
