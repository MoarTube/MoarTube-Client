# Cloudflare Tunnel URL audit — 2026-11-04

The audit covers the URL-policy implementation in MoarTube Client and Node, including tunnel lifecycle, settings transitions, media publication/recovery, delivery, and viewer pages. It does not complete milestone 6's live named-account/CDN transitions or remaining platform checks.

## Findings fixed

| Finding | Result and regression coverage |
| --- | --- |
| Recovered encoder jobs without a saved media base rejected their old absolute segment URLs. | Recover only the exact video's rendition and encoder segment filename after checking the job's original Node connection. Preserve signed URLs and external keys; general playlist migration still rejects unknown managed origins. Client `tests/public-node-url.test.ts` and `tests/recovered-hls.test.ts`. |
| Completed recovery receipts could skip an old playlist when the destination had not changed. | Persist a manifest URL version only after successful upload. Older completed receipts must normalize and upload once; subsequent retries can skip. Interrupted filesystem/S3 uploads leave an incomplete receipt and retry successfully. Client `tests/public-node-url.test.ts`. |
| Known root-relative S3 bucket paths stayed absolute to the endpoint root. | Strip a configured path-style bucket prefix before computing the document-relative reference. Node `tests/unit/utils/url-audit.test.ts` and Client `tests/hls-urls.test.ts`. |
| An unknown bucket prefix on a recognized origin could silently survive migration. | Reject ambiguous references in the managed video's namespace until their former media base is known. The same Node/Client regressions cover this independently of origin recognition. |
| Non-HTTP external references could be treated as managed relative paths when their path matched the video namespace. | Preserve non-HTTP URI schemes before considering managed path conversion. Node and Client `hls-urls.test.ts` cover this alongside signed and external key references. |
| A configured local HTTPS address with an explicit default port could produce an HTTP share link. | Compare origins using the configured protocol before the direct HTTP fallback. Node `tests/unit/utils/url-audit.test.ts`. |
| Any private-IP Host header qualified as a local canonical address. | Accept configured local origins, loopback, and actual local interfaces; reject an arbitrary private Host. Forwarded host/protocol headers remain ignored by canonical-link selection. Node `tests/unit/utils/url-audit.test.ts` and `tests/unit/config/viewer-urls.test.ts`. |
| Invalid legacy CDN settings could prevent origin-history collection during repair, including filesystem-only relative delivery. | Collect the valid Node origin and saved history even when the current optional media base cannot be derived. Invalid history, failed persistence, and unknown absolute playlist origins still fail explicitly. Node `tests/unit/utils/url-audit.test.ts` and `tests/unit/utils/media-url-origins.test.ts`. |

The baseline also exposed stale test fixtures: the settings browser test omitted the real Cloudflare UI scripts, HTML rendering mocks omitted valid settings, and a Cloudflare timeout test lacked the required modal name/header API and expected an obsolete error message. These fixtures now exercise the current contracts. The timeout test still verifies cancellation, a fresh recovery signal, and release of the settings lock.

## Verification

| Check | Result |
| --- | --- |
| Full Node default suite | 3,280 passed, zero failed; 171 files. |
| Full Client default suite | 320 passed, zero failed; 64 files. Seven opt-in cases skipped by default. |
| Opt-in real S3 HLS suite | Five passed against isolated Silo storage with actual FFmpeg-generated MPEG-TS segments. Covers anonymous delivery/cache metadata, growing playlists and validators, VOD finalization, missing-rendition failure/retry, and resuming after cleanup. |
| Real browser and public quick-tunnel smoke | Passed six playback/seek scenarios: direct watch, public watch, public embed, direct watch after disable, direct watch after disabled restart, and public watch after re-enable with a fresh hostname. Actual WS/WSS registration passed, public canonical origins matched, and there were zero script errors, wrong media/resource origins, or failed Node resources. |
| Lifecycle and cleanup in the browser smoke | One connector while enabled, zero after disable and disabled restart, and one after re-enable. Stored old absolute playlist bytes stayed unchanged while normalized delivery kept working. The container exited 0; its anonymous volume was removed. |
| Type checking and changed-source lint | Both repositories passed; Node lint reports existing test-file ignore warnings, with zero source errors. |
| Production builds | Client and Node native bundles passed; production Linux amd64 Docker image built successfully. |

The default suites exercise all eight filesystem/S3 × CDN off/on × tunnel off/on URL-selection combinations, controlled named REST/DNS ownership and failure cases, authenticated settings contracts and actual browser modal/toggle behavior. Real S3 migration/rollback tests are included in the Node suite. Controlled Cloudflare responses do not establish live account/DNS/CDN correctness.

Reproduction commands, from each repository root:

```powershell
npx.cmd vitest run --coverage.enabled=false
npm.cmd run typecheck
npm.cmd run build
```

From the Client root, the opt-in S3 HLS checks require Docker and a real FFmpeg executable:

```powershell
$env:MOARTUBE_TEST_HLS = '1'
$env:MOARTUBE_FFMPEG = 'C:\path\to\ffmpeg.exe'
npx.cmd vitest run tests/integration/hls-silo.integration.test.ts --coverage.enabled=false
```

The manual browser/lifecycle regression harness is `tests/browser/tunnel-url-smoke.mjs`. It builds synthetic HLS fixtures, starts its own two-worker production container and public quick tunnel, and removes that container and its anonymous volume afterward. It never restarts an existing user Node. From the Client root:

```powershell
docker build --platform linux/amd64 -t moartube-node:url-audit ../MoarTube-Node
$env:MOARTUBE_FFMPEG = 'C:\path\to\ffmpeg.exe'
node tests/browser/tunnel-url-smoke.mjs
```

The optional `MOARTUBE_NODE_IMAGE` variable selects another already-built compatible Node image. A working Docker daemon, Playwright Chromium installation, and internet access for the public quick tunnel are required. Run the harness serially; its latest result is written to `temp/url-audit/smoke-results.json`.

Local machine-readable reports and generated fixtures are under ignored `temp/url-audit/`. Baseline reports recorded three Node and three Client failures. Four additional Node defect regressions were observed failing before their fixes. Permanent regressions are in the repositories' normal test directories.

## Remaining verification boundaries

- Live named-account provisioning, real DNS/CDN certificate propagation, and quick → named → quick storage/CDN transitions remain milestone 6 work.
- macOS/Linux ARM/other native-platform execution and the two opt-in hardware/backend tests were not run in this audit. The Linux amd64 production image was built and used for isolated runtime checks.
- Publication rules remain the existing public-media model: viewer pages omit sources for unpublished, non-live videos, but raw public files/storage URLs and legacy source/watch APIs are not a privacy boundary. This URL work does not implement private HLS or revoke already-known public media URLs.
- Existing user Node processes and saved provider/account settings were not changed. No live named-account or DNS mutations were performed.

See the [URL policy](cloudflare-tunnel-url-policy.md) and [milestones](cloudflare-tunnel-milestones.md).

Subsequent milestone 6 work completed native Windows npm-consumer and emulated Linux ARM64 runtime/installer checks. Those results supersede the earlier platform limitations above; live named/CDN and native macOS checks are still pending. See the [milestone 6 verification report](cloudflare-tunnel-verification.md).
