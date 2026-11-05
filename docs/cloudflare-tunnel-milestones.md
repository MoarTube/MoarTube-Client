# Cloudflare Tunnel implementation milestones

Status: milestones 1–5 and the [URL policy](cloudflare-tunnel-url-policy.md) prerequisite fix are implemented. Milestone 6 has passed Windows x64, Linux amd64, and emulated Linux ARM64 quick-tunnel verification. Live named-account/CDN/storage transitions and macOS execution remain pending; see the [verification report](cloudflare-tunnel-verification.md).

## Scope and agreed behavior

Node settings are authoritative. `isCloudflareTunnelEnabled` defaults to `true` and independently controls both quick and named tunnels. `cloudflareTunnelName` stores the generated quick name or the name supplied during CDN enablement. The enabled flag replaces all previous name-based enable/disable rules and explicit first-creation/save flows.

Add **Cloudflare Tunnels** with a toggle to the right of **Cloudflare Turnstile**. There is no standalone name field, name save button, creation button, chooser, or help link. Do not display the generated quick name anywhere in the Client UI for now. The CDN enablement modal gets a fourth input, **Cloudflare Tunnel Name**.

An enabled Node starts a quick tunnel when CDN is disabled, including first startup without a name. Every successful quick creation saves Cloudflare's new generated name. With CDN enabled, use a named tunnel with the name supplied in the CDN modal. Turning the tunnel toggle off stops either mode and remains effective across Node restarts and CDN changes.

CDN enablement must respect a disabled tunnel toggle: save the named configuration but keep the connector stopped until tunnels are enabled. This preserves the user's explicit stop choice. With tunnels enabled, successful CDN enablement restarts the connector as named; disabling CDN restarts it as quick and replaces the stored name.

| Cloudflare Tunnels | Cloudflare CDN | Desired tunnel state |
| --- | --- | --- |
| Off | Off | Stopped |
| Off | On | Stopped; named configuration retained |
| On | Off | Quick tunnel; Cloudflare generates the name |
| On | On | Named tunnel using the CDN modal name |

An enabled preference is distinct from a running connector. Invalid named configuration or a connector failure must report an error while retaining the enabled preference; it must not be mistaken for the user toggling tunnels off.

Implement milestones in order and run focused tests/checks with each change. Milestone 6 adds full cross-repository and live verification; it does not defer testing of earlier milestones.

## Milestone 1 — Settings foundation and contract

- [x] Add optional `cloudflareTunnelName` to Node and Client models and the Node validation schema.
- [x] Add `isCloudflareTunnelEnabled` to both models; default it to true in Node validation when absent, preserving an explicit false.
- [x] Support both values through existing Node JSON settings persistence and retrieval, preserving unrelated modeled settings; do not store them in Client settings.
- [x] Implement the pure startup policy: disabled means no tunnel; enabled without CDN means quick even without a name; enabled with CDN means named using a valid saved name.
- [x] Preserve read-only behavior: reading/defaulting settings does not launch connectors. Legacy settings without the flag default to enabled for subsequent startup integration.
- [x] Retain name normalization and validated generated quick URL label extraction. Names no longer act as the tunnel off switch.
- [x] Define authenticated toggle and revised CDN configuration contracts, authoritative lifecycle responses, and partial-failure reporting.
- [x] Record primary-process ownership, startup/shutdown hooks, local origin, connector deployment, REST authentication, permissions, and account lookup.
- [x] Record toggle placement, hidden generated names, required fourth CDN modal input, and the precedence of explicit tunnel disablement.

See [Cloudflare Tunnel contract](cloudflare-tunnel-contract.md) for details and official references. These checks cover settings code and contracts; connector and UI effects remain in later milestones.

Validation after the toggle redesign: Client and Node type checks passed, changed-source lint passed, and all 95 focused Node configuration tests passed. No live tunnel was created.

## Milestone 2 — Node manager and startup

- [x] Implement one primary-process tunnel manager with start, stop, restart, and serialized reconciliation; HTTP workers request operations through IPC.
- [x] Start after an HTTP worker is ready, reading the latest enabled/CDN settings. Disabled means no REST creation or connector launch.
- [x] On enabled startup with CDN disabled, create a quick tunnel even if no name exists. Save the generated name on every successful creation, overwriting its predecessor.
- [x] On enabled startup with CDN enabled, provision/reconcile a named tunnel over REST using saved modal name and credentials, then run its connector.
- [x] Invalid/missing legacy named configuration reports an actionable error and does not silently fall back to quick mode.
- [x] Resolve `cloudflared`, verify it, target the local Node origin, and implement the recorded native/container deployment strategy.
- [x] Keep at most one connector active; stop it on shutdown and wire primary signal handling without respawning workers during shutdown.
- [x] Report readiness and REST/process/persistence errors accurately; reconcile or stop a newly created connector if generated-name persistence fails.
- [x] Keep local Node HTTP access available if connector installation, startup, or provisioning fails. Retain the enabled preference and expose the lifecycle error rather than exiting the Node or silently switching modes.
- [x] Handle unexpected connector exits with bounded retry/backoff while enabled; re-read settings before each retry and cancel pending retries on disable/shutdown.
- [x] Track remote UUID/credentials separately, reuse owned resources safely, journal owned resources for reuse and compensate for initial ownership-write failures, and keep tokens out of Client responses/logs.

Milestone 2 validation (2026-11-04): Node type checking and lint for the new services/cluster code passed; 515 distinct focused/regression tests passed across 19 test files. The production Linux amd64 Docker image built successfully with checksum-verified cloudflared 2026.10.7 and CA certificates. An isolated live quick-tunnel test verified initial name persistence, public/local heartbeat access, persistent off behavior after restart, fresh-name replacement after re-enabling, and clean shutdown (exit 0). The test container and anonymous data volume were removed.

Named REST provisioning, ownership/DNS handling, cancellation, retries, and failures were tested with controlled processes/mocked responses. No live named-account operation was performed. Native Windows/macOS and Linux arm64 execution remain part of milestone 6. Interactive toggling and CDN modal transitions are implemented in milestones 3–4 below. See the [Node runtime guide](../../MoarTube-Node/docs/cloudflare-tunnel.md).

## Milestone 3 — Cloudflare Tunnels toggle

Integration points: `public/views/settings.ejs`, Client settings routes/controller/API service and types, and Node settings routes/controller/service. Use active TypeScript under `src/`.

- [x] Add **Cloudflare Tunnels** with an accessible toggle immediately to the right of **Cloudflare Turnstile** on desktop; preserve order when the layout wraps.
- [x] Load its state from Node settings, defaulting missing values to enabled consistently with the Node schema.
- [x] Keep the toggle usable regardless of CDN mode; disable it only while its request is pending.
- [x] Persist toggle changes through authenticated endpoints. Off stops quick or named tunnels; on starts the mode selected by the current CDN setting.
- [x] Turning off preserves the stored name and CDN configuration, remains off across restarts, and prevents automatic tunnel startup. Milestone 4 also preserves this preference during CDN transitions.
- [x] Display errors and refresh authoritative settings/runtime state after changes or timeouts. Distinguish failed persistence from a saved preference whose lifecycle operation failed.
- [x] Do not add a standalone tunnel-name input/save control, separate creation control, or the previous help link.
- [x] Do not display the generated quick name in any Client UI, including success/error messages. Milestone 4 must retain this restriction for its new modal.

Milestone 3 validation (2026-11-04): Client build/type check, Node type check, and the production Node Docker build passed. Lint reported no errors (existing warnings remain in the API/settings files). The selected Client/settings browser/proxy suites passed 6 tests; Node toggle/settings/route/manager/IPC/cluster suites passed 178 tests. Desktop and mobile screenshots were visually reviewed. Browser coverage includes default-on state, operation with either CDN state, duplicate-listener prevention, pending disablement, partial persistence failures, lost-response refresh, and hidden generated names.

An isolated live authenticated quick-tunnel off/on/off cycle verified process stop/start, name preservation on stop, new-name persistence on re-enable, and rejected unsigned requests. A subsequent Node restart verified the saved off preference, local access, zero connectors, and clean shutdown (exit 0). The test container/data volume were removed. Live named-account and full CDN transition checks remain in milestone 6.

## Milestone 4 — CDN modal and mode transitions

- [x] Add a fourth input to the CDN enabling modal after email address, zone ID, and global API key: **Cloudflare Tunnel Name**, placeholder `name`.
- [x] Require a valid nonempty normalized name for CDN enablement, validating on Client and Node. Do not prefill it from a generated quick name.
- [x] Extend the existing CDN configure request to include `cloudflareTunnelName`; persist it atomically with the successful CDN configuration and reuse saved credentials for REST provisioning.
- [x] If tunnels are enabled, successful CDN enablement restarts the active quick connector as a named tunnel using the modal name; reconcile into named mode if no connector is running.
- [x] If tunnels are disabled, successful CDN enablement saves configuration/name without starting a connector or changing the tunnel toggle.
- [x] When CDN is disabled and tunnels are enabled, restore owned DNS before clearing old credentials, then reconcile as quick after releasing settings admission; save the generated name and keep it hidden from Client UI.
- [x] When CDN is disabled and tunnels are disabled, keep the connector stopped; do not create a quick tunnel or generate a name.
- [x] Cancelled or rejected CDN configuration preserves prior saved settings and connector mode. Once configuration is persisted, later distribution/lifecycle failures explicitly report `settingsSaved: true` and actual state rather than claiming rollback.
- [x] Keep all lifecycle effects on Node so they work without an open settings page.

Milestone 4 validation (2026-11-04): Client build/type check and production Node Docker build/type check passed. Lint has no new errors (existing warnings remain). Focused Client browser/API/settings suites passed 9 tests; Node controller/service/manager/REST/DNS/IPC suites passed 252 tests. Coverage includes both tunnel preferences, name validation/normalization, stop-preserving DNS restoration, restored record IDs, failed configuration, post-save partial failures, and IPC errors. Desktop/mobile modal screenshots were reviewed; the CDN dialogs now override the dashboard's fixed minimum width on phones. Both modal cancellation paths, no quick-name prefill/display, and controls refreshed after partial/lost responses were verified in the browser.

REST and named-mode transitions used controlled processes/mocked provider responses. No live Cloudflare account configuration/DNS changes were made. Live account transitions remain in milestone 6. Milestone 5 adds concurrency and cleanup recovery below.

## Milestone 5 — Reconciliation and failure recovery

- [x] Serialize toggle and CDN changes across workers; reload committed settings before launch and prevent stale operations from starting a connector after a newer disable.
- [x] Re-enabling tunnels uses the latest saved CDN mode/name; quick re-enablement obtains and saves a fresh random name.
- [x] Unchanged toggle requests do not restart a healthy connector unnecessarily; lifecycle failures can be retried through reconciliation.
- [x] Failed persistence retains previous settings. A persisted disabled flag with a failed stop reports an error and retries cleanup rather than falsely claiming that the connector stopped.
- [x] Preserve the chosen enabled flag across CDN rollback/recovery and avoid stale snapshots overwriting a newer preference.
- [x] Handle owned remote resource reuse, changed named configuration, DNS/ingress updates, and cleanup without deleting unrelated resources.

Milestone 5 validation (2026-11-04): 626 affected Node tests across 28 files and six Client browser/API tests passed. Both repositories passed type checking; the Client and production Linux amd64 Node image built successfully. Changed-source lint passed with the existing Node settings-controller warnings. Coverage includes a real separate-process admission conflict, overlapping CDN/toggle requests, duplicate/coalesced reconciliation, committed disable at launch, bounded automatic retries with explicit retry recovery, failed-stop cleanup, unreadable settings, and early connector exits. Client tests verify an actionable conflict message and authoritative refresh after HTTP 409.

Ownership recovery tests cover recorded UUID reuse/rename, definite remote deletion, authorization failures, interrupted journal/DNS writes, rollback-restored aliases, obsolete hostnames, and filesystem/S3 handoff. An unrecorded UUID whose compensating deletion also fails suspends automatic provisioning and requires storage/account inspection before an explicit retry. Named-account and platform checks remain in milestone 6.

An isolated live two-worker Node verified concurrent toggle requests settle to the final saved disable, duplicate enables maintain one connector, quick re-enablement saves a fresh name, and an unchanged enable retains the same process. After forcibly terminating the connector, disabling canceled recovery. Restarting Node retained the disabled preference with zero connectors and working authenticated local access. Shutdown exited cleanly (0); the test container and anonymous data volume were removed. No live named-account or DNS mutations were performed.

## Milestone 6 — Verification

Resolved URL blocker (2026-11-04): a public quick-tunnel watch response and HLS playlists contained `http://localhost:9090` resource/media URLs. The updated build uses viewer-relative Node resources/filesystem sources, document-relative managed HLS references, and independent S3/CDN media selection. Canonical links follow the URL policy. Full milestone 6 verification remains outstanding; connector readiness and heartbeat checks alone do not establish usable playback.

Prerequisite sequence:

- [x] Document the eight storage/CDN/tunnel combinations, URL rules, supported qualifications, and extension boundaries in the [URL policy](cloudflare-tunnel-url-policy.md).
- [x] Implement the URL policy and its focused acceptance criteria, including existing filesystem/S3 playlist handling and transition recovery.
- [x] Repeat public watch/embed playback verification after the fix using isolated synthetic media and record the result below.
- [ ] Complete the milestone 6 scenarios below, including outstanding live named-account/CDN/storage transitions and platform checks.

URL policy validation: 598 affected Node tests across 20 files and 59 Client tests across nine files passed. Both repositories passed type checking, changed-source lint (existing warnings remain), and native builds; the production Linux amd64 Docker image built successfully. Tests cover all eight URL-selection combinations, Client origin resolution, old/new playlist delivery, signed/external reference preservation, real filesystem/S3 migration failures and retries, persistent origin history, live finalization/cache policy, canonical origin precedence, and bounded read-only snapshot IPC.

An isolated two-worker Node served synthetic HLS media whose stored playlists deliberately contained old localhost URLs. A real browser verified advancing playback, seeking, poster/assets, share links, WebSocket connections, and embedded playback through direct access and public quick tunnels, with zero failed Node resources, wrong media origins, or script errors. Disabling the tunnel retained direct playback/local-only sharing; restart retained off with zero connectors. Re-enabling assigned a new hostname and public playback/share links worked without modifying public settings or stored playlist bytes. Test containers and anonymous volumes were removed after clean shutdown (exit 0). No live account/DNS/storage-provider configuration was changed; the user's existing Node process was not restarted.

| Scenario | Expected result |
| --- | --- |
| Fresh/default Node, CDN off, no name | Quick tunnel starts; generated name is persisted and hidden in Client UI. |
| Missing enabled flag in existing settings | Defaults to enabled; startup follows CDN mode. Reading settings alone starts nothing. |
| Explicitly disabled; either CDN mode; Node restart | No connector or remote creation; disabled state persists. |
| Toggle off during quick or named tunnel | Connector stops; name/CDN configuration are preserved. |
| Toggle back on, CDN off | New quick tunnel; new random name replaces stored name. |
| Toggle back on, CDN on | Named tunnel uses the saved modal name/configuration. |
| Enabled; CDN enablement with fourth input succeeds | Named tunnel starts/restarts using the supplied name. |
| Disabled; CDN enablement succeeds | Configuration/name saved; tunnel stays disabled and stopped. |
| Enabled; CDN disabled | Quick tunnel starts; new generated name saved and hidden. |
| Disabled; CDN disabled | Remains stopped; no quick creation. |
| Blank/invalid modal name, cancelled or failed CDN enabling | Validation/error shown; previous configuration and runtime remain unchanged. |
| Concurrent toggle/CDN requests, restart or shutdown | Latest persisted preference wins; at most one connector. |
| REST/process/write/stop failures | Accurate saved state and lifecycle error; no silent fallback or leaked connector. |
| Connector fails at startup or exits unexpectedly | Local Node remains available; error/retries are reported; disable/shutdown cancels retries. |

- [x] Add Node lifecycle, REST, persistence, concurrency, and failure coverage; retain focused schema/policy coverage.
- [x] Add authenticated Client-to-Node toggle and revised CDN payload contract tests.
- [x] Add UI coverage for toggle placement/defaults/rollback, the four modal inputs, validation, and hidden generated names.
- [x] Live-test first quick startup, quick stop/re-enable, and disabled preference across restarts.
- [ ] Live-test quick-to-named-to-quick transitions while enabled, including actual named-host playback, DNS restoration, and fresh quick-name persistence.
- [ ] Live-test named stop/re-enable and restart while named mode is disabled, including recorded UUID reuse and public playback recovery.
- [ ] Live-test CDN enable/disable while tunnels remain disabled, including saved configuration/name changes with no connector creation.
- [ ] Live-test filesystem/S3 media distribution with actual Cloudflare CDN, including playback, cache behavior, and storage/CDN transitions.
- [x] Verify a fresh native Windows x64 npm consumer installation, actual package-relative connector execution, quick lifecycle, and clean shutdown.
- [x] Verify Linux amd64 production Docker runtime and public/direct browser playback.
- [x] Verify Linux ARM64 production Docker runtime under emulation, matching connector download/execution, public/direct browser playback, and actual ARM-only npm host installation/reuse.
- [ ] Verify native macOS x64 and ARM64 installation/execution on compatible hosts.
- [x] Run applicable checks in both repositories and record environment-dependent checks still outstanding.
- [x] Document default public tunnel startup, toggle behavior, connector installation, Cloudflare permissions, troubleshooting, and cleanup.

Audit follow-up (2026-11-04): the full Node suite passed 3,280 tests and the full Client suite passed 320 tests. Five opt-in real S3 HLS checks also passed. Both repositories passed type checks, changed-source lint (test-file ignore warnings remain), production builds, and the Linux amd64 Docker build. See the [audit report](cloudflare-tunnel-url-audit.md) for fixes, permanent regression tests, isolated browser smoke results, and the live account/platform checks still outstanding. Milestone 6 remains open for those live transitions and platform checks.

Milestone 6 follow-up (2026-11-04): fresh Windows npm-consumer and emulated Linux ARM64 runtime checks passed, including public quick access, off/restart/on, host-only executable selection, and clean shutdown. ARM64 also passed six browser playback/seek scenarios and actual ARM-only npm download/reuse. Reusable checks are in `tests/browser/tunnel-windows-smoke.mjs` and `tests/browser/tunnel-url-smoke.mjs`; the latter accepts explicit image/platform/report-directory overrides. No product source changes were needed. The current Node has no saved Cloudflare credentials, and no macOS host is configured; those resources have been requested. Pending live cases remain unchecked. See the [verification report](cloudflare-tunnel-verification.md) for evidence and reproduction steps.

Feature completion requires all runtime/UI acceptance criteria and live transition checks. Milestone 1 alone does not implement tunnel functionality.
