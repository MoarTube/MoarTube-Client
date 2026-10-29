# Build output layout

Generated files stay under `build/desktop` or `build/ffmpeg`, ignored by Git.
FFmpeg targets are `win32-x64`, `linux-x64`, `linux-arm64` and `darwin-x64`.
Desktop packages use the same four targets. Darwin native CI qualification is
pending; see [the macOS guide](electron-darwin.md).
The build commands are unchanged.

## Desktop

```text
build/desktop/
  releases/<target>/<app-version>/       Installer, portable archive, sources, checksums, release notes
  work/<target>/packages/               Unpacked app and electron-builder diagnostics
  work/<target>/staging/<ffmpeg-id>/     Temporary FFmpeg runtime/source staging
  assets/                              Generated application icons
  cache/electron/                      Downloaded Electron distributions
  cache/builder/                       Downloaded packaging tools
  profiles/<target>/development/        Development application data
  profiles/<target>/smoke-*/            Automated test profiles
  profiles/linux-x64/ubuntu-*/          Exported Linux test profiles
  reports/<target>/development/         Development smoke JSON/screenshots
  reports/<target>/packaged/            Packaged smoke JSON/screenshots
  reports/linux-x64/ubuntu-*/           Installed/portable Linux validation evidence
  logs/<target>/                       Captured build/validation console logs
  state/<target>/                       Current FFmpeg selection and packaging metadata
  archive/<target>/                     Preserved older outputs and validation attempts
```

For version 1.1.0, publish from:

- `build/desktop/releases/win32-x64/1.1.0`
- `build/desktop/releases/linux-x64/1.1.0`

Only release assets go in these folders. Unpacked application directories and
builder diagnostics stay in `work`. `desktop:pack:*` produces only the work
directory; `desktop:build:*` finalizes the download files into `releases` and
writes checksums there. Keep the matching separate FFmpeg sources available.
For Docker-based Linux builds, temporary packaging work stays in the container;
the host receives release assets, reports and test profiles. The pre-migration
Linux unpacked app is retained in `archive/linux-x64/work`.

Installed app data is unaffected: Windows still uses AppData and Linux still
uses its XDG configuration directory. Repository `data/` for the CLI is also
unaffected. The paths above refer only to developer outputs and test profiles.

## FFmpeg

```text
build/ffmpeg/
  install/<target>/bin/                 Compiled FFmpeg/FFprobe used by the client (stable path)
  candidates/<target>/<build-id>/       Unpacked, verified candidate with provenance and notices
  releases/<target>/<build-id>/         Downloadable FFmpeg/source archives and checksums
  state/<target>/selected.json          Current candidate selection
  reports/<target>/                     Feature, software, dependency and hardware evidence
  logs/<target>/                        Captured build/validation console logs
  cache/sources/                        Checksum-locked upstream source downloads
  cache/toolchains/<target>/            Checksum-locked compiler/bootstrap downloads
  cache/npm/                            Retained auxiliary npm download cache
  toolchains/win32-x64/msys64/           Installed portable Windows compiler
  work/<target>/                        Extracted sources and compiler object files
  archive/<target>/                     Prior workspaces and older diagnostics
```

Windows full candidates and their ZIPs are separate. Linux candidates contain
`runtime/` and `source/`; their runtime/source `.tar.xz` files are in `releases`.
Selection files point to candidates, not download ZIPs. The client continues to
resolve `install/<target>/bin`, so moving release files never changes the runtime
dependency location.

Windows' old source/object workspace was archived rather than rewriting compiler
caches that contain absolute paths. Its compiler and download caches were
retained; the new workspace is prepared from those pinned inputs. Linux compiler
workspaces remain on Docker volumes and use the same target-based layout inside
the container. Neither migration nor packaging changes the bytes of an existing
compiled FFmpeg pair.

## Migration and history

`scripts/organize-build-outputs.ps1` migrates the earlier layout on Windows:

```powershell
# Preview only:
powershell -NoProfile -File scripts/organize-build-outputs.ps1
# Apply checked moves within this repository's build directory:
powershell -NoProfile -File scripts/organize-build-outputs.ps1 -Apply
```

It refuses to overwrite existing destinations or move paths outside `build`.
It preserves downloads, candidates, archives, profiles and evidence, updates
current selection paths, and removes only empty obsolete category folders.
Historical archives, logs and reports are not rewritten: paths embedded in old
evidence may describe the original layout. Old published filenames and archive
checksums remain valid. New builds use the new layout directly; no compatibility
symlinks or old `output`/`artifacts` folders are required.

Paths are defined centrally in `tooling/build-paths.cjs`. Update that contract and
its consumers when adding another platform instead of inventing a parallel layout.

## Layout validation (2026-10-28)

- All original desktop release checksums matched after migration; the preserved
  copies are in `archive/<target>/releases/1.1.0-before-layout-validation`.
- All four installed FFmpeg/FFprobe executables retain their original SHA-256
  hashes, including the Linux pair rebuilt through the updated paths.
- The relocated Windows compiler/source preparation and PE dependency inspection
  passed. Windows Electron packaging and its packaged smoke checks passed.
- Linux FFmpeg compilation, feature/software/ELF checks, desktop packaging, and
  Ubuntu 24.04/26.04 installed/portable lifecycle tests passed.
- The 157 client tests, six FFmpeg tooling tests and type checking passed; the
  opt-in hardware tests remain skipped. Desktop policy tests passed, with the
  Linux process-tree test also passing inside the Linux build container.
- Current candidate selections and release checksums resolve through the new
  folders. A second migration preview reports zero remaining moves. The obsolete
  top-level `desktop/output` and `ffmpeg/artifacts` directories are absent.

Latest logs are `build/desktop/logs/<target>/layout-build.log`,
`build/desktop/logs/linux-x64/layout-verification.log`, and
`build/ffmpeg/logs/linux-x64/layout-build.log`. This organization work adds no new
native GPU or Wayland qualification claims.

After that validation, an explicitly approved cleanup removed superseded
candidates/releases, the pre-layout archive backups, the unused npm cache and
old desktop staging (24 directories, about 13.77 GiB). Current release assets,
matching sources, selected candidates, compiler tools, profiles and active
reports remain. All four compiled executables retained their hashes and current
release checksums passed again. The cleanup receipt is stored under
`build/desktop/state/cleanup-20261028-152415.json`. Historical validation records
may reference backup files removed by this later cleanup.
