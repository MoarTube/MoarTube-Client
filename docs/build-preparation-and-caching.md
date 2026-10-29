# Build preparation and caches

The desktop and FFmpeg workflows prepare network dependencies before compiling.
They first restore caches and validate any compiled FFmpeg candidate. Desktop
jobs then install npm dependencies and download Electron and packaging tools,
before downloading missing FFmpeg source/toolchain archives or preparing its
compiler. macOS also obtains its matching Node license during preparation.
Completed npm, desktop-tool and verified source downloads are saved immediately,
before later preparation, tests or compilation can fail. Compiled FFmpeg is
verified and cached immediately after a successful build/package step.

Linux builds prepare compiler, desktop-dependency and test-runtime images before
compilation. The dependency image includes the native npm modules, Electron,
7zip and FPM. Desktop preparation first runs with `--desktop --downloads-only`,
preparing its base Linux environment and exporting npm/Electron/tool downloads
for immediate caching. After FFmpeg inputs have also been downloaded and cached,
`--desktop --environment-only` prepares the FFmpeg compiler and test images;
it does not reinstall desktop dependencies. Without either phase flag, the
helper still prepares everything, with desktop downloads first.
Test images include the application's declared system packages and
Playwright. The DEB declaration and prepared runtime use the same package list.
Prepared Linux compiler, packaging and runtime-check containers run with Docker
networking disabled; package tests use local-only `dpkg --install` and npm offline
installation. Missing prerequisites therefore cannot silently trigger a late
download. Ordinary Windows/WSL developer commands can still prepare their Docker
environment on demand when not using the CI preparation flag.

The end-to-end workflow installs Playwright browsers immediately after npm
dependencies, before its checks/client build, restoring and immediately saving
the browser downloads in a separate cache. Its self-hosted MoarTube Node
server remains a prerequisite, not something the workflow provisions.

Downloads of newly built Actions artifacts, uploading releases, cache transfers,
runner provisioning and checkout inherently still need network access. Preparing
build dependencies does not make those operations offline or guarantee that an
external server will be available.

## Three cache layers

- Download caches contain checksum-locked source/toolchain archives. A restored
  archive is rehashed before use. Incomplete download sets are not saved under
  the permanent key. Complete downloads can be saved when a later build fails.
- Desktop dependency caches contain Electron/packaging downloads and npm cache
  data. Linux caches these in a tar archive to preserve Unix symlinks and modes
  even when preparing containers from Windows. npm dependencies remain locked
  by `package-lock.json`; native modules are installed for the target platform.
- Compiled FFmpeg caches contain the checked binaries, immutable candidate,
  matching corresponding sources/release archives, selection and binary-bound
  verification records. They do not contain active compiler workspaces.

A matching compiled cache skips FFmpeg compilation and packaging. Before reuse,
the cache verifier checks its target, current recipe fingerprint, qualification,
both runtime/install binary hashes, upstream archive hashes and packaged archive
checksums. Windows selection paths are rebased to the current checkout.
Corrupt or inconsistent restored candidates fail validation rather than being
silently trusted. Desktop packages are still built from the current client code.

Compiled keys separate OS/CPU targets and include Node version and the FFmpeg
source/toolchain/build/verification recipe. Windows also includes the FFmpeg
client-command snapshot and qualification documents embedded in its source
package. macOS includes the hosted runner image version because its toolchain
is supplied by that image. Changes to unrelated UI files do not invalidate the
FFmpeg cache. Recipe fingerprints are shared with the packagers to avoid drift.

## Retention and invalidation

GitHub's default is to evict caches unused for more than **seven days**. Regular
access refreshes last use; the default repository cache allowance is **10 GB**,
with older entries evicted when space is needed. Administrators can configure
larger storage limits; this implementation does not change
account limits or opt in to paid storage.

A key change makes the old entry inapplicable immediately, regardless of its
storage age. Eviction or a missing key simply causes preparation/recompilation.
Local download caches have no automatic time limit; they remain until removed
and their checksums are still verified before use.
Changing workflow/client UI code alone does not necessarily change the FFmpeg
key. A cache is an optimization, not durable release storage. Our Actions build
artifacts retain their separate 14-day policy; uploaded release assets remain
part of their draft/published release.

See [GitHub's caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
for the current eviction and repository scope rules.
