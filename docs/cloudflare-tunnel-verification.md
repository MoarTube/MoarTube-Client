# Cloudflare Tunnel milestone 6 verification

Milestone 6 is complete only when its live account transitions and supported platform checks have passed. Passing controlled provider tests does not substitute for live Cloudflare account, DNS, or CDN verification.

## Evidence carried forward

- Full suites: 3,280 Node and 320 Client tests passed. These cover settings/schema defaults, authenticated contracts, UI validation and rollback, named REST ownership/DNS recovery, concurrency, persistence, cancellation, retries, and failure reporting.
- Five opt-in checks passed against actual Silo S3-compatible storage and FFmpeg-generated segments, including live/VOD caching, failure/retry, finalization, and stream resumption.
- A production Linux amd64 container passed real browser watch/embed playback and seeking through direct access and public quick tunnels, WS/WSS registration, canonical link selection, and resource-origin checks. Off persisted across restart with zero connectors; re-enable generated a new public hostname. Existing playlist bytes remained unchanged. Cleanup exited 0 and removed the anonymous volume.
- Type checks, changed-source lint, production bundles, and the Linux amd64 Docker build passed. See the [audit report](cloudflare-tunnel-url-audit.md).

## Platform runs in this milestone

| Target | Check | Status |
| --- | --- | --- |
| Windows x64 npm consumer | Fresh local tarball install, host-only postinstall, native package-relative connector from another working directory, quick public access, off/restart/on, and graceful shutdown. | Passed, native Windows. |
| Linux amd64 production Docker | Existing real browser and lifecycle evidence above. | Passed. |
| Linux ARM64 production Docker | Build ARM64 image, download/checksum the matching connector, then run real browser/lifecycle checks under Docker CPU emulation. | Passed under emulation. Actual Node architecture and connector digest/version independently checked. |
| macOS x64 / ARM64 | Actual installation and execution on compatible macOS hosts. Platform-selection/archive unit tests already pass. | Awaiting a macOS host; Windows cannot execute the Mach-O binaries. |

The locally packed npm tarball is 1,067,208 bytes compressed / 4,573,601 bytes unpacked and contains no generated platform executables. The Windows consumer's postinstall obtained only `win32-x64/cloudflared.exe`; its SHA-256 is checked before the runtime smoke.

Windows native results: first quick startup saved its generated name; the one connector's actual executable path matched the installed npm package. Disabling retained that name, restart retained off with zero connectors and working local HTTP, and re-enable obtained a fresh working public hostname. Both graceful shutdowns exited 0 and stopped the connector.

ARM64 results: the production image built successfully; Node reported `linux/arm64`, and the executed cloudflared 2026.10.7 binary matched pinned digest `3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775`. Six browser playback/seek scenarios passed, including public embed, direct access after disable/restart, and public access through a fresh hostname. WS/WSS registration and canonical/resource-origin checks passed with zero script errors, wrong origins, or failed Node resources. Stored playlist bytes remained unchanged. The test container exited 0 and its anonymous volume was removed.

The npm host installer also executed on ARM64 in a separate disposable container: it downloaded only `linux-arm64`, verified and executed the real binary, then reused it without downloading on the second invocation. These are actual architecture execution checks, rather than mocked platform selection.

Reproduce the Windows runtime check from the Client root after installing the local Node tarball into a disposable consumer directory:

```powershell
$env:MOARTUBE_NODE_PACKAGE = 'C:\path\to\consumer\node_modules\@moartube\moartube-node'
node tests/browser/tunnel-windows-smoke.mjs
```

The Windows harness uses isolated data and a free local port. It imports the installed launcher from a different working directory, identifies only that primary process's connector, and invokes the real primary shutdown handler through a test-only marker. This avoids Windows' immediate `process.kill` termination and does not change the installed application. It does not restart or edit an existing user Node.

Reproduce the ARM64 container check:

```powershell
docker build --platform linux/arm64 -t moartube-node:milestone6-arm64 ../MoarTube-Node
$env:MOARTUBE_NODE_IMAGE = 'moartube-node:milestone6-arm64'
$env:MOARTUBE_NODE_PLATFORM = 'linux/arm64'
$env:MOARTUBE_TUNNEL_SMOKE_DIR = 'temp/tunnel-m6/arm64-browser'
$env:MOARTUBE_FFMPEG = 'C:\path\to\ffmpeg.exe'
node tests/browser/tunnel-url-smoke.mjs
```

The architecture is executed under Docker emulation on this Windows/amd64 workstation; this is not evidence of performance on physical ARM hardware. The browser and fixture encoder run on the host, while Node, its native dependencies, and cloudflared run inside the ARM64 container.

## Live account scenarios still requiring execution

| Scenario | Required observations |
| --- | --- |
| Quick → named → quick while enabled | Submit the fourth modal value through the authenticated configure path. Verify saved name, owned UUID, ingress and DNS, actual named-host playback/assets/WS, connector count, then DNS restoration and a fresh working quick hostname after clear. |
| Named off → on | Off preserves configuration/name and stops the child. On reuses the recorded owned UUID and saved name. Verify public playback returns without creating duplicate remote tunnels. |
| Restart while named mode is disabled | No child or remote creation; local access works. Re-enable uses current saved named configuration. |
| CDN enable/disable while tunnels stay disabled | Settings/name change but no child starts. Restart preserves off. Re-enable chooses the current CDN mode. |
| Filesystem / S3 media with live CDN | Exercise each valid distribution transition with actual public master/rendition/segment delivery, bucket prefixes, CORS, ranges as applicable, cache headers/invalidation, and correct Node versus media origins. |
| Rejected/cancelled configuration and cleanup | Reject invalid names and unavailable permissions without changing saved state. Record partial-save errors accurately. Restore pre-test DNS/zone settings and delete only test-owned remote resources after recording evidence. |

The current Node has no saved Cloudflare email, zone ID, or global API key. A dedicated test zone and a local credentials-file path have been requested. CDN configuration changes zone-wide behavior, so these tests must use a dedicated test zone rather than repurposing a production zone. Keep credentials in a local file outside version control and do not include keys or connector tokens in reports or command-line arguments.

A macOS host has also been requested. Until these inputs are available, the live named/CDN and macOS rows remain pending and the milestone must not be marked complete.

Detailed local reports and logs are under ignored `temp/tunnel-m6/`. Generated test resources use isolated settings/data, random process/container identities, and synthetic media.
