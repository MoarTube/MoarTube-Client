# Linux Electron validation — 2026-10-28

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

Under `build/desktop/output/linux`:

| File | Approximate size | SHA-256 |
| --- | --- | --- |
| `MoarTube-Client-1.1.0-linux-x64.deb` | 135.8 MiB | `bc7071ff03f6b364f99dc2cf8feb16f6296df186f8a6969478cc0c460601c3d8` |
| `MoarTube-Client-1.1.0-linux-x64.tar.gz` | 160.8 MiB | `2d7b45bcf7abcc173ef40224d3d82fa2ca59b0443f0fbe680fbc1579c67dc648` |
| `9.0.2-moartube-linux-x64-8828825bb7df5b22-r5e8a647b-sources.tar.xz` | 28.7 MiB | `00b77ea17ec2763530e2cf9a68762db792bcc06ec6d684ba461b13bacc5fda6a` |

Checksums and release-note templates accompany the downloads. FFmpeg sources are
separate from the application payload. All Chromium locales remain present.

Evidence is under `build/desktop/linux-ubuntu-24.04` and `linux-ubuntu-26.04`,
including installed/portable smoke JSON, screenshots, logs, library/package
inventories and `installation-result.txt`. Final logs are
`build/desktop/linux-build-final-artifacts.log` and
`build/desktop/linux-verification-final-artifacts.log`. Windows regression
packaging evidence is `build/desktop/windows-linux-regression-package.log` and
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
