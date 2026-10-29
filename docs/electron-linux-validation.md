# Linux Electron validation — 2026-10-28

## Current x64 follow-up: isolated Node backend

This record describes the existing Node 22.23.4 packages. New builds pin Node
24.22.1; the recorded downloads and their hashes have not been rebuilt by that
configuration change.

The ARM64 implementation exposed a Sharp/GLib conflict during real image
processing on Ubuntu 26.04. Linux packages now bundle standalone Node 22.23.4
for the backend. Both x64 Ubuntu versions passed the image/backend IPC probe
and full installed/standalone sandboxed GUI suite with this change. Current
FFmpeg is `9.0.2-moartube-linux-x64-8828825bb7df5b22-r534f153d`.

Current assets are in `build/desktop/releases/linux-x64/1.1.0`:

- DEB SHA-256: `45ab1600ab1715ce662ff0128d9f4ab0ac31313109f2884cef364a0328b3509e`.
- Standalone SHA-256: `712a702572595dc47fa9db7b83fadcf28375ae019b3e3dbfa0d8eae51f97ba17`.
- Source SHA-256: `0e35b723ca3cffcc362901e71a934d880ae056296fc4a1746d3cb3c9686abfad`.

Current evidence is under `build/desktop/reports/linux-x64/ubuntu-*` and
`verification.json`; logs for this regression are
`build/desktop/logs/linux-arm64/x64-final-verification.log`.
[ARM64 validation](electron-linux-arm64-validation.md) records its separate scope.
The original validation below describes the earlier utility-process candidate.

## Earlier candidate

MoarTube Client 1.1.0, Electron 45.1.0, Linux x64. Built from Windows 11 in an
Ubuntu 24.04 container on the existing WSL 2-backed Docker engine. Bundled FFmpeg:
`9.0.2-moartube-linux-x64-8828825bb7df5b22-r5e8a647b`.

## Passed on Ubuntu 24.04 and 26.04 containers

- Install the actual DEB with APT and resolve its declared runtime libraries.
- Check the application desktop entry/window-class identity, bundled project
  license, component/source notices, and AppArmor profile syntax.
- Launch the installed app as a non-root user under Xvfb, with Chromium sandbox
  enabled, no Node/Electron API in the renderer, and context isolation enabled.
- Display the sign-in UI, preserve settings/media, use the normal XDG-derived
  profile, and verify File menu data/log folder paths.
- Launch a second instance and keep the original window/backend.
- Close the window and verify both the local endpoint and owned backend exit.
- Extract and launch the standalone archive from a path with spaces and Unicode
  characters; repeat the same storage, isolation and lifecycle checks.
- Reinstall the same DEB version, remove it, and retain the test profile/media.
- Preserve a simulated pre-existing npm `moartube-client` command; the desktop
  launcher uses the separate `moartube-client-desktop` command.

The six desktop tests pass inside the Linux build, including a real backend/tree
termination test with stale-PID-identity rejection. Client type checking passes.
Windows development and freshly packaged Windows smoke tests also pass with the
shared entry point and File menu assertions.

## Deliverables

These original, pre-layout-validation downloads are preserved under
`build/desktop/archive/linux-x64/releases/1.1.0-before-layout-validation`.
New builds use the [current output layout](build-outputs.md).
Those obsolete backup downloads were subsequently removed by an approved
cleanup; the hashes below remain a historical validation record. Current
downloads and checksums are in the release folder described by the output guide.

| File | Approximate size | SHA-256 |
| --- | --- | --- |
| `MoarTube-Client-1.1.0-linux-x64.deb` | 135.8 MiB | `bc7071ff03f6b364f99dc2cf8feb16f6296df186f8a6969478cc0c460601c3d8` |
| `MoarTube-Client-1.1.0-linux-x64.tar.gz` | 160.8 MiB | `2d7b45bcf7abcc173ef40224d3d82fa2ca59b0443f0fbe680fbc1579c67dc648` |
| `9.0.2-moartube-linux-x64-8828825bb7df5b22-r5e8a647b-sources.tar.xz` | 28.7 MiB | `00b77ea17ec2763530e2cf9a68762db792bcc06ec6d684ba461b13bacc5fda6a` |

Checksums and release-note templates accompany the downloads. FFmpeg sources are
separate from the application payload. All Chromium locales remain present.

Original evidence is under
`build/desktop/archive/linux-x64/reports/before-layout-validation/ubuntu-24.04`
and its `ubuntu-26.04` sibling,
including installed/portable smoke JSON, screenshots, logs, library/package
inventories and `installation-result.txt`. Final logs are
`build/desktop/logs/linux-x64/linux-build-final-artifacts.log` and
`build/desktop/logs/linux-x64/linux-verification-final-artifacts.log`. Windows regression
packaging evidence is `build/desktop/logs/win32-x64/windows-linux-regression-package.log` and
the normal packaged smoke report.

## Qualification limits

Both Ubuntu containers share the WSL kernel and use a virtual X11 display.
The test container gets the namespace capability needed by Chromium; its sandbox
is kept enabled. An application-specific AppArmor profile is bundled and parsed,
but this is not physical Ubuntu/GNOME/Wayland kernel-policy qualification.
The portable test configures the container-local sandbox helper; normal Ubuntu
users should prefer the DEB's system integration.

Native NVIDIA/AMD/Intel GPU execution, Wayland, full Node-connected workflows,
version-to-version migrations and other distributions remain unqualified.
Same-version reinstall is not a future upgrade/migration test. No release was
published, no host application was installed, and no host GPU/AppArmor settings
were changed. See [the Linux desktop guide](electron-linux.md).
