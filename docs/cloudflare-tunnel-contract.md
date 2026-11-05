# Cloudflare Tunnel settings and lifecycle contract

Settings and lifecycle contract for the default-enabled toggle design. Milestones 1–5 implement settings, the Node manager, startup/shutdown, REST provisioning, IPC, runtime status, the authenticated Client toggle, CDN modal/mode transitions, and reconciliation/failure recovery. Full live/account/platform verification remains in milestone 6. This supersedes the earlier name-field/save/explicit-initialization designs.

The [URL policy](cloudflare-tunnel-url-policy.md) defines the eight storage/CDN/tunnel combinations and the implemented URL/playback fix identified by live quick-tunnel inspection. Viewer-relative Node resources/filesystem sources, external S3/CDN media destinations, document-relative managed HLS references, and canonical public links are separate decisions. Focused tests and isolated public quick-tunnel playback pass in the updated build; milestone 6 remains open for full live named-account/CDN/storage and platform checks.

## Settings and names

Node `_node_settings.json` is authoritative:

- `isCloudflareTunnelEnabled: boolean` defaults to `true` when missing. Explicit false remains false. This is the independent on/off switch for quick and named tunnels.
- `cloudflareTunnelName?: string` stores the current generated quick label or configured named-tunnel name. An empty name no longer means that tunnels are disabled.
- `isCloudflareCdnEnabled` selects quick versus named mode only when tunnels are enabled.

The Client reads these through its existing `GET /settings/node` proxy to authenticated Node `GET /settings`; neither value belongs in Client settings. Node's existing partial-update writer validates, writes a temporary file, atomically renames it, and restores prior memory on persistence failure. Preserve unrelated modeled settings and reload settings under serialized mutation admission.

Missing names are valid in quick mode: enabled first startup creates a quick tunnel and saves Cloudflare's generated name. Legacy settings without the enabled flag now default to enabled. Reading/defaulting settings alone never launches a connector; milestone 2 wires the startup policy into the manager. With the flag false, no automatic mode starts even if a name exists.

Normalize names by trimming surrounding whitespace. Persisted names allow empty values for quick-mode initialization/legacy compatibility; the CDN modal must require a nonempty normalized value. Application policy limits names to 100 characters, preserves case/internal spaces, and rejects control characters and URL/path separators (`/`, `\`, `:`, `?`, `#`). This is application policy; provider errors remain authoritative.

For a quick URL such as `https://random-words-here.trycloudflare.com`, persist only `random-words-here`. Validate HTTPS and the exact generated single-label hostname, with no credentials, nonstandard port, query, fragment, or path. Every successful quick creation overwrites the prior name. Keep public URL, named resource UUID, credentials, and name separate. Do not display generated quick names anywhere in Client UI for now.

The pure `automaticCloudflareTunnelMode` returns `none` when disabled, `quick` when enabled without CDN even if no name exists, and `named` when enabled with CDN and a nonempty name. Enabled legacy CDN configurations missing a name select no connector and must report a configuration error; never silently fall back to quick mode.

The two flags form a complete decision table: tunnels off means stopped in either CDN state; tunnels on with CDN off means quick; tunnels on with CDN on means named. For invalid enabled named configuration, a `none` policy result indicates an error requiring configuration repair, not a disabled preference. The lifecycle response must preserve this distinction.

## Client UI and authenticated API

Place **Cloudflare Tunnels** with a toggle to the right of **Cloudflare Turnstile**, preserving order on narrow layouts. No standalone name input/save button, creation button, chooser, or old help link remains. The toggle is usable in both CDN modes and stays available after failure; disable it only while its request is pending.

Add **Cloudflare Tunnel Name**, placeholder `name`, as the fourth CDN enabling modal input, after email address, zone ID, and global API key. Require a valid nonempty name. Do not prefill or otherwise expose a generated quick name in this modal. The modal name configures the named tunnel; it is not an on/off switch.

| Operation | Client endpoint | Node endpoint | Contract |
| --- | --- | --- | --- |
| Read existing settings | `GET /settings/node` | `GET /settings` | Read-only; enabled flag and optional name included. |
| Read runtime status | `GET /settings/node/cloudflare/tunnel` | `GET /settings/cloudflare/tunnel` | Authenticated, uncached snapshot; no provisioning. |
| Toggle tunnels | `POST /settings/node/cloudflare/tunnel/toggle` | `POST /settings/cloudflare/tunnel/toggle` | `{ "isEnabled": boolean }`; strict boolean, existing bearer authentication on Node and session token through Client proxy. |
| Enable CDN | `POST /settings/node/cloudflare/configure` | `POST /settings/cloudflare/configure` | Existing three credential fields plus required `cloudflareTunnelName`. Validate all before mutation. |
| Disable CDN (existing) | `POST /settings/node/cloudflare/clear` | `POST /settings/cloudflare/clear` | Preserve tunnel enabled preference; reconcile mode only when enabled. |

No separate tunnel-name save or initialization endpoint exists. The CDN modal, Client proxy validation, Node schema, and atomic credential/name save now require the fourth field together. Legacy callers omitting the name receive validation failure before mutation.

Off persists false and stops any quick/named connector, retaining the name and CDN configuration. On persists true and starts the mode selected by CDN settings. Enabling CDN while tunnels are disabled saves the supplied name/configuration but leaves the connector stopped and toggle off. This gives the user's explicit stop preference precedence. Enabling CDN while tunnels are enabled restarts/reconciles as named using the modal name. Disabling CDN with tunnels enabled restarts/reconciles as quick and saves the new generated name; with tunnels disabled it creates nothing.

Failed/cancelled CDN configuration leaves the previous saved state and connector unchanged. A successfully persisted change followed by a lifecycle failure is a partial failure, not a configuration rollback. Return the actual saved flags/name and runtime snapshot; refresh authoritative state after mutation errors and network timeouts. Do not show generated quick names in user-visible error/success messages.

Toggle mutations and successful/partially saved CDN transitions return `CloudflareTunnelMutationResponse`:

```json
{
  "isError": false,
  "settingsSaved": true,
  "isCloudflareTunnelEnabled": true,
  "isCloudflareCdnEnabled": false,
  "cloudflareTunnelName": "random-words-here",
  "tunnel": {
    "mode": "quick",
    "status": "running",
    "name": "random-words-here",
    "publicUrl": "https://random-words-here.trycloudflare.com"
  }
}
```

The API may carry the name for state reconciliation without displaying it. `mode` is `none | quick | named`; `status` is `stopped | starting | running | error`. Runtime `name` identifies the actual connector, while top-level name/flags reflect persisted desired state. These can differ after a failed transition. Include a URL only when known for that connector; sanitize messages and never include keys, tokens, or provider request headers.

Reject invalid input with HTTP 400 and invalid state conflicts with 409. Toggle-handler rejections before persistence return `isError: true`, `settingsSaved: false`; framework validation/authentication errors may use the standard error envelope and perform no mutation. After persistence succeeds but lifecycle fails, return HTTP 502, `isError: true`, `settingsSaved: true`, actual saved flags/name and actual runtime/error. A saved false whose connector fails to stop stays false while cleanup retries; do not report a successful stop prematurely. The existing broad settings response already includes CDN credentials; new responses must not expose connector secrets.

The toggle handler releases the cross-worker settings writer lock before awaiting primary IPC, allowing quick reconciliation to acquire that lock for generated-name persistence. The Client proxy preserves the Node HTTP status and partial-save body; it does not pass this mutation through the generic helper that throws on errors and discards the saved-state fields. The UI disables only its pending toggle, refreshes settings and runtime after every outcome (including timeouts), and displays fixed messages without provider data, generated names, or public URLs.

CDN configure/clear likewise release distribution admission before reconciliation. Disabling CDN first invokes the primary-owned `prepare_cdn_clear` operation inside the existing provider rollback boundary, while old credentials remain available. It restores only journaled owned DNS routes and leaves the connector running until configuration commits. Failure propagates through correlated, sanitized IPC errors without clearing credentials or starting quick mode. The ownership snapshot is retained for rollback/reuse, and restored DNS values remain reusable if Cloudflare assigns a different record ID. After commit, reconciliation uses the latest flags; failures in post-save invalidation or connector work report a partial save. The Client preserves these fields and refreshes both controls/runtime.

## Lifecycle ownership and integration

- `src/moartube-node.ts` initializes configuration/database/container before `ClusterMaster.start`. The primary process owns one connector manager; HTTP workers send correlated lifecycle requests over IPC rather than spawning connectors.
- `src/core/cluster/master.ts` owns connector cleanup and primary `SIGINT`/`SIGTERM` handling. It marks the cluster stopped before terminating workers, preventing shutdown respawn, and reports failed connector termination.
- Workers listen on `0.0.0.0` using `nodeListeningPort`; the current Fastify instance is plain HTTP. Target `http://127.0.0.1:<nodeListeningPort>`, start after a worker is ready, and reconcile listening-port/server changes. Do not use the public/CDN URL as the local origin.
- Reuse `withSettingsChange` for cross-worker settings admission and a primary-owned lifecycle queue. Reload committed settings before writes/launches. A newer disabled flag must prevent stale queued operations from restarting a connector.
- Startup with enabled quick mode requires no existing name. Capture the generated name, persist it, then report readiness. On failed persistence, stop/reconcile the new connector and surface cleanup errors.
- Enabled named mode requires valid saved CDN credentials and a nonempty modal name. No fallback to quick after named provisioning errors. Disabling tunnels stops the connector without clearing named configuration; re-enabling uses the latest saved configuration.
- Repeated unchanged toggle requests should not restart a healthy connector unnecessarily. An error state may be reconciled/retried. CDN rollback/recovery must preserve the latest tunnel preference.
- Connector/provisioning failures must not prevent the local Node HTTP server from operating or silently clear the enabled preference. Report lifecycle errors separately from Node availability. Unexpected connector exits use bounded retry/backoff, re-reading settings before retry; disabling tunnels and shutting down cancel retries.

## Connector deployment decision

Support Node's existing Windows, macOS, and Linux targets where Cloudflare publishes a matching binary. The Node resolves `MOARTUBE_CLOUDFLARED_PATH`, otherwise its matching npm-installed package-local executable, then `cloudflared` from PATH if no package-local executable exists. It verifies the version and manages the executable as a child with an argument array, no shell, and hidden Windows window. Each child uses an isolated configuration; named tokens pass through its environment, never command-line arguments. Missing executable reports an error without a runtime download.

The npm postinstall script downloads only the current platform's cloudflared 2026.10.7 executable for Windows x64 or Linux/macOS x64/arm64. It checks the pinned official release digest before installing atomically; macOS archive and extracted binary digests are both verified. A valid existing executable is reused. The tarball ships the built runtime, installer scripts, and upstream license/attribution, excluding generated executables even when present locally. Its prepack step builds Node without downloading binaries. Source checkouts/manual recovery use `npm run install:cloudflared`; use `--prefix <installed-package-directory>` to run it from elsewhere. Other architectures require a compatible separately installed binary. Docker skips the npm downloader during dependency installation and downloads only its own architecture's binary during the build, including CA certificates. No executable is downloaded at Node runtime. macOS and Linux arm64 execution remain in milestone 6.

The host-only installer reduces the npm tarball from approximately 101 MB to 1.06 MB compressed, with approximately 4.54 MB unpacked before dependency installation and the platform binary download. Automatic installation requires npm lifecycle scripts and GitHub access. A failed automatic download warns without blocking local Node installation; the manual command fails normally. `MOARTUBE_SKIP_CLOUDFLARED_INSTALL=1` or an explicit `MOARTUBE_CLOUDFLARED_PATH` skips the automatic download. Failed verification/downloads never replace a previous executable. Existing permission repair/private-copy fallback remains available for manually copied/read-only installations. Fresh Windows installation/reuse and 44 focused tests passed; no npm publication was performed.

A genuine isolated Linux npm installation also downloaded only its matching executable through postinstall, reused it on retry, and started a quick tunnel with local HTTP available. Its two-worker Node ran from a different working directory without `cloudflared` on PATH. Docker's successful build explicitly skipped the npm download and performed its own architecture-specific download. The consumer test container and anonymous data volume were removed after shutdown exited 0.

## Cloudflare REST provisioning decisions

Verified against official documentation; no account mutations were made:

- Resolve the account from `GET /client/v4/zones/{savedZoneId}` using `result.account.id`. Do not confuse zone ID with account ID. Zone details supports the existing email/global-key authentication and requires zone-read access. [Zone Details](https://developers.cloudflare.com/api/resources/zones/methods/get/).
- Create a remotely managed named tunnel with `POST /client/v4/accounts/{accountId}/cfd_tunnel`, using the persisted name and `config_src: "cloudflare"`. The API documents `X-Auth-Email` plus `X-Auth-Key` authentication, so the existing saved CDN credentials can be reused. Account authorization must permit tunnel creation; documented accepted token permissions include Cloudflare Tunnel Write or a listed connector-write equivalent. Credential validity for CDN alone does not prove tunnel authorization. [Create a Cloudflare Tunnel](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/create/).
- Provision ingress through the tunnel configurations REST endpoint, include a final catch-all rule, and launch the connector with its returned token. Configure the public hostname's DNS route to the tunnel UUID separately; do not treat the display name as a DNS route. Publishing requires DNS write authorization. Reconcile the existing CDN DNS records rather than blindly creating conflicting records. These runtime and routing operations belong to milestone 2. [Cloudflare setup flow](https://developers.cloudflare.com/tunnel/get-started/).
- Quick creation runs `cloudflared tunnel --url <local-origin>` and parses the generated HTTPS URL. It requires no Cloudflare account; each new quick tunnel has a new hostname. This supports the chosen random-label persistence policy. [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
- Install the architecture-appropriate official binary according to the deployment decision above. [Cloudflared downloads](https://developers.cloudflare.com/tunnel/downloads/).

Existing named resource reuse, route updates, and cleanup are ownership-aware: track the managed UUID privately and never delete a resource solely because its name matches. Connector tokens stay in memory; UUID metadata belongs to private Node storage, separately from the user-facing name. Only a definite missing/deleted recorded resource permits recreation; authorization or network failures do not.

## Reconciliation and recovery

Provider/distribution operations acquire a shared cross-process tunnel admission lock before the existing settings writer lock. Conflicting changes return HTTP 409 without saving; the Client explains the conflict and refreshes authoritative state. Toggle writes release the writer before primary reconciliation. A disabled preference bypasses provider admission so cleanup can proceed promptly. Immediately before spawning, the primary strictly reloads committed settings and checks the desired configuration while holding the writer lock; changed or disabled settings reject stale launches. A failed strict read suspends startup instead of using a cached enabled preference.

The primary coalesces matching pending requests and discards superseded queued operations. Unchanged healthy settings reuse the connector. Configuration fingerprints include the named credentials, name, origin, hostname, zone, and storage mode; generated quick names do not cause a restart. Automatic recovery has a bounded retry budget; explicit reconciliation starts a fresh budget. Requested-stop exit callbacks cannot schedule replacement connectors. Failed stops retain the handle and retry cleanup, including stop-only cleanup that never launches a replacement.

The private ownership journal records route replacement intent before DNS mutation, including both the previous and pending owned UUID targets. Restored routes are marked released while retaining originals for provider rollback. Obsolete owned routes are restored after new ingress/DNS is configured; externally changed released records are left alone. Explicit S3 media targets release filesystem tunnel ownership without overwriting the S3 record. Cross-zone cleanup completes inside rollback boundaries before new credentials/settings commit, preserving the prior preference on failure. If initial UUID journaling and compensating remote deletion both fail, automatic provisioning stops and reports that storage/account inspection is required before explicit retry.
