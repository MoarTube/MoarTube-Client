# macOS Client and Client + Node builds

Four GitHub Actions workflows cover the two variants and architectures:

| Workflow | File |
| --- | --- |
| macOS x64 - Client | `.github/workflows/electron-build-darwin-client-x64.yml` |
| macOS x64 - Client + Node | `.github/workflows/electron-build-darwin-client-node-x64.yml` |
| macOS ARM64 - Client | `.github/workflows/electron-build-darwin-client-arm64.yml` |
| macOS ARM64 - Client + Node | `.github/workflows/electron-build-darwin-client-node-arm64.yml` |

Each builds only its selected variant, then verifies its ZIP and DMG on native
macOS 15 and 26 runners of the matching architecture. The all-platform workflow
calls all four. Only Client + Node workflows check out MoarTube Node and install
its dependencies and Cloudflared.

Leave `release_tag` empty to keep the downloads as workflow artifacts. Providing
an existing draft release tag uploads downloads only after verification passes;
it does not publish the release.

Each architecture produces:

| Variant | Disk image | Application archive |
| --- | --- | --- |
| Client | `MoarTube-Client-<version>-darwin-<arch>.dmg` | `MoarTube-Client-<version>-darwin-<arch>.zip` |
| Client + Node | `MoarTube-Client-Node-<version>-darwin-<arch>.dmg` | `MoarTube-Client-Node-<version>-darwin-<arch>.zip` |

Checksums and release notes are separate for each variant. Matching FFmpeg
sources accompany both. Build outputs are in
`build/desktop/releases/darwin-<arch>/<version>/`; reports are under
`build/desktop/reports/darwin-<arch>/<client|bundled>/`.

Client connects to a separately managed Node. Client + Node starts and manages
its own local Node, uses the existing automatic/manual login behavior, and
stores its Client and Node data separately under
`~/Library/Application Support/MoarTube/client_node/`. Standalone Client data
remains under `~/Library/Application Support/MoarTube/client/`.

Both architectures run the Client backend and bundled Node primary through
Electron utility processes. Node cluster workers use Electron's Node runtime;
no standalone Node executable is distributed. Client dependencies and shared
JavaScript stay in `app.asar`, and bundled Node JavaScript stays in `node.asar`.
Native SQLite, Cloudflared, image WASM, logging workers and public assets retain
real disk paths. No startup archive extraction is added.

The shared, version-audited dependency pruning and Node consolidation rules
remove build-only dependencies, development materials and duplicate JavaScript
while retaining runtime files and license notices. Matching Client + Node
source/build materials are a separate optional
`MoarTube-Client-Node-<version>-darwin-<arch>-<hash>-sources.zip` download,
required by bundle checksums and draft uploads. `resources/node-SOURCES.txt`
records its URL and SHA-256. The installer does not unpack these sources.

ZIP uses Deflate level 6 and DMG uses UDZO level 6 by default. Set
`ELECTRON_BUILDER_COMPRESSION_LEVEL` to override the level. These use macOS's
normal ZIP/DMG paths; NSIS settings and its cached installer copy apply to
Windows. Electron locales remain included. No Darwin installation-time or
file-count improvement is claimed before native builds supply measurements.

## Native local commands

Build on a matching native Intel or Apple Silicon Mac running macOS 15 or later,
using native Node.js 24.22.1 or newer. Rosetta and cross-building from Windows
are not supported. In the Client checkout, run `npm ci`. For a bundle build,
also run `npm ci` and `npm run install:cloudflared` in a sibling
`MoarTube-Node` checkout, or set `MOARTUBE_NODE_SOURCE` to that checkout.

On Intel:

```sh
npm run ffmpeg:build:darwin
npm run desktop:build:darwin:all
npm run desktop:verify:darwin:all
```

On Apple Silicon:

```sh
npm run ffmpeg:build:darwin:arm64
npm run desktop:build:darwin:arm64:all
npm run desktop:verify:darwin:arm64:all
```

To reverify an existing selected FFmpeg candidate without recompiling, use
`npm run ffmpeg:verify:darwin` on Intel or
`npm run ffmpeg:verify:darwin:arm64` on Apple Silicon. These require matching
native macOS hardware and an existing built/restored candidate. They validate
binary hashes, Mach-O architecture and deployment baseline, ad-hoc signatures,
system-library dependencies, compiled features and software-media behavior.
They do not re-sign binaries or change the selected candidate.

Reports are written under
`build/ffmpeg/reports/darwin-<arch>/verification/<run>/`, with a `latest.json`
pointer in the `verification/` directory. Existing build/cache evidence remains
intact. Darwin workflows run this verification when reusing compiled FFmpeg;
fresh builds invoke the same shared checks directly. VideoToolbox hardware
qualification remains separate.
The refactor changes the FFmpeg recipe hash, so previously compiled workflow
caches will not match the new key. The standalone verification commands still
test an existing candidate without recompiling it.

Use `:client` or `:client-node` in place of `:all` to select a single variant.
Install the compiler tools used by the workflows before compiling FFmpeg:
`brew install cmake ninja meson nasm pkg-config xz`.

To produce runnable `.app` bundles without DMG/ZIP archives, use
`npm run desktop:pack:darwin:all` on Intel or
`npm run desktop:pack:darwin:arm64:all` on Apple Silicon. Both also offer
`:client` and `:client-node` in place of `:all`. These commands perform the same
compilation and preparation, then package with `--dir`. They verify the `.app`
signatures and runtime contents, skip DMG verification, and do not generate
release checksums.

The `.app` bundles are written under
`build/desktop/work/darwin-<arch>/packages/<client|bundled>/mac/` on Intel,
or `mac-arm64/` on Apple Silicon. The same native build prerequisites apply.
The `desktop:verify:darwin:…` commands verify distribution archives; they require
the full `desktop:build:darwin:…` output.

## Verification and signing

Verification checks signatures, Mach-O architecture and deployment baseline,
FFmpeg hashes, ASAR placement, absence of standalone Node, image processing,
backend IPC, and ZIP/DMG installation paths
containing spaces and Unicode characters. Bundle verification also exercises
SQLite, Cloudflared's local version command, managed startup/shutdown, login,
tray/preferences, persistent data and share playback. It does not open public
Cloudflare tunnels.

Packaged Electron probes run after ad-hoc signing; staging checks also exercise
SQLite and Cloudflared before packaging. Bundle verification checks Electron's
RunAsNode fuse, matching source archive hashes, utility processes, cluster worker
changes and shutdown cleanup. Package reports record regular-file, symlink and
ASAR-entry counts for comparison with the other platforms.

Packages use ad-hoc signing and are not notarized. macOS may block a browser
download; use the system's manual approval in Privacy & Security if you trust
the artifact. Native CI checks do not establish downloaded-app Gatekeeper
approval, physical Mac compatibility or VideoToolbox hardware support.

No new Darwin build or verification result is claimed by this implementation;
the next workflow runs provide that evidence.
