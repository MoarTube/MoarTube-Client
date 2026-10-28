# Linux desktop application

The initial packages have passed the installed and standalone container checks
on both Ubuntu versions. See [the validation record](electron-linux-validation.md)
for exact artifact hashes, evidence and remaining native-host qualification.

MoarTube Client has an Electron option for Ubuntu 24.04 and 26.04 x64. Windows
remains available; macOS, ARM64 and other Linux distributions remain future work.
Linux releases contain the client, Electron, Sharp and the verified Linux FFmpeg
and FFprobe pair. Users need no Node.js, npm, compiler or separate FFmpeg download.
GPU drivers remain system prerequisites. Connect to an existing MoarTube Node;
the desktop application does not install a Node server.

## Install and launch

Download `MoarTube-Client-<version>-linux-x64.deb` and open it with your system's
software installer, or install with APT so system libraries are resolved:

```bash
sudo apt install ./MoarTube-Client-1.1.0-linux-x64.deb
```

Launch **MoarTube Client** from the application menu, or run `moartube-client-desktop`.
The separate command name preserves an existing npm `moartube-client` CLI.
The installed application is in `/opt/MoarTube Client`; the command and desktop
entry are installed through the normal package machinery. The DEB declares the
Electron GTK/NSS/audio/graphics libraries and FFmpeg VA-API/DRM/GnuTLS dependencies.
This initial local package is not published through a signed APT repository;
verify its download against `SHA256SUMS-linux-x64.txt`.

Quit or closing the window stops imports, publishing, live streams and the owned
backend. There is no background tray mode or automatic resumption of jobs. The
renderer keeps context isolation, no Node integration, restricted navigation and
Chromium sandboxing. The DEB includes electron-builder's application-specific
AppArmor profile for Ubuntu 24.04+; it does not disable system AppArmor or launch
with `--no-sandbox`.

Settings and media are stored at:

```text
${XDG_CONFIG_HOME:-~/.config}/MoarTube Client/
├── client/
│   ├── _client_settings.json
│   ├── media/videos/
│   └── temp/
├── logs/client.log
└── Electron browser profile/cache
```

The File menu opens the data and log folders. Uninstalling leaves this profile
intact. Existing CLI data is not migrated or shared automatically. Development
uses `build/desktop/dev-user-data-linux-x64`, separate from installed and Windows
profiles.

## Standalone archive

`MoarTube-Client-<version>-linux-x64.tar.gz` contains the complete application
directory. Extract it fully on Linux and run `moartube-client-desktop` from that directory.
The archive preserves executable permissions and retains all Chromium locales.
It uses the same XDG profile as the installed app.

The standalone archive requires the same system libraries as the DEB. Ubuntu's
AppArmor restrictions can also require app-specific sandbox configuration for an
arbitrary extraction location. Prefer the DEB for normal Ubuntu use: it manages
dependencies, launch integration and sandbox setup. Do not work around failures
by disabling Chromium's sandbox or changing system-wide namespace restrictions.
No AppImage, Snap, Flatpak or RPM is produced in this initial implementation.

## Build from Windows, WSL or Linux

Use Node.js 22+ and Docker with Linux containers. Docker Desktop's existing WSL 2
backend can build from Windows without installing another Linux distro:

```powershell
npm.cmd run ffmpeg:build:linux
npm.cmd run desktop:dist:linux
npm.cmd run desktop:verify:linux
```

Use `npm` instead of `npm.cmd` in WSL/Linux. The FFmpeg step can be skipped when
the verified Linux candidate already exists. Desktop packaging fails with a
compile-first error if it is missing. It verifies binary and corresponding-source
checksums, preserves the immutable FFmpeg candidate, and stages only runtime
resources into the app. Native modules are installed for Linux inside the
Ubuntu 24.04 build container; Windows `node_modules` are never reused.

For a Linux checkout with native dependencies already installed, use:

```bash
npm ci
npm run desktop:dev
npm run desktop:dist:linux:native
# Or produce only the application directory:
npm run desktop:pack:linux:native
```

Native development still needs the Linux desktop libraries and a working Chromium
sandbox. `desktop:dist:linux` supplies the isolated packaging environment instead.
Neither build command installs anything on the host. Failed build/test containers
are retained for diagnostics; successful task containers are removed. No global
Docker pruning or host GPU driver installation is performed.

## GitHub Release assets

`build/desktop/output/linux` contains:

- `MoarTube-Client-<version>-linux-x64.deb`
- `MoarTube-Client-<version>-linux-x64.tar.gz`
- `<FFmpeg-build-id>-sources.tar.xz`
- `SHA256SUMS-linux-x64.txt`
- `RELEASE-NOTES-linux-x64.md`

Upload the application downloads, source archive and checksums together. Review
and paste the generated release notes. The default tag is `v<package version>`;
set `MOARTUBE_RELEASE_TAG` before building to use another tag, since it is embedded
in the source-download information. Keep matching sources available while their
binaries are distributed. The Help menu opens license texts and the exact source
download URL/checksum. Sources remain an optional download for users.

Linux checksums and release-note filenames are platform-specific so they can
coexist with Windows assets in the same GitHub Release. The manual
`desktop-linux.yml` workflow builds FFmpeg and Electron, runs container tests,
and uploads candidates without publishing a release.

## Validation scope

`desktop:verify:linux` creates separate Ubuntu 24.04 and 26.04 containers, installs
the actual DEB with its dependencies, parses the AppArmor profile, and launches
the app as an ordinary user under a virtual X11 display. It verifies the sign-in
UI, Node isolation, active Chromium sandbox flag, XDG storage, File menu paths,
settings/media preservation, single-instance behavior and backend exit. It also
reinstalls the same version, removes it and checks that the profile remains.
The standalone archive is launched from a Unicode/space path. A simulated
existing npm CLI command is checked before and after installation/removal.
It does not modify an installed host profile.

Containers need the `SYS_ADMIN` namespace capability for this Chromium sandbox
test; no `--no-sandbox` flag is used. These checks share the WSL Linux kernel and
do not qualify physical Ubuntu hosts, GNOME/Wayland, actual GPU pipelines or full
Node-connected sign-in/import/publishing/live workflows. Those remain required
before broad stable-release claims. Same-version reinstall is not proof of a
future version-to-version data migration. Automatic updates are not implemented.

References: [electron-builder Linux packaging](https://www.electron.build/v26/docs/linux/),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
