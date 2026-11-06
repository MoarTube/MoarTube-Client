# CDN audit resolution notes

This describes the fixes following [the lifecycle audit](cdn-lifecycle-audit.md). The audit document and its observation probes preserve the pre-fix behavior; the permanent regression tests in the repositories assert the corrected behavior.

## Changes

| Finding | Implemented correction | Main regression coverage |
| --- | --- | --- |
| F01: incomplete provider rollback untracked | A private transition record is saved before provider mutation. Failures keep the intended direction, target address, managed name, provider snapshots, and pending state. Retry resumes the recorded phase rather than attempting another configuration. | Node `cloudflare-cdn-tunnel.test.ts`: provider/DNS/capture/settings failures, retry identity, admission blocking. |
| F02: outstanding writes overlap migration | HTTP media mutations hold shared OS-backed write admission until work and invalidation finish. Transitions require exclusive admission. Direct Client storage writes register durable activity before writing and release it only after invalidation succeeds. Cancellation waits for publishing/import work to drain before clearing Node activity. | Node upload/activity tests; Client `publish-queue.test.ts` and `client-cdn-fixes.test.ts`. |
| F03: another toggle bypasses recovery | Pending transitions reject configure/clear and other distribution edits. The Client disables its ordinary CDN toggle while recovery is pending. | Node pending-toggle and changed-storage tests; Client recovery browser test. |
| F04: stale worker overwrites state | Every `Config.updateNodeSettings` patch takes writer admission and reloads the document before merging. Calls inside an existing settings transaction share only its live ownership; callbacks cannot inherit expired ownership. | Node `config/cdn-state.test.ts`: actual persistence, stale workers, live/expired lock ownership, failed persistence. |
| F05: final old-zone purge lost on restart | Source and target zone credentials remain in the private transition until post-media whole-zone purging and queued invalidation finish. Startup re-arms media migration and purging if startup cleanup could invalidate a saved checkpoint. | Node lifecycle tests, including actual child-process termination at the post-media purge boundary, and startup rewind tests. |
| F06: stale retries start untracked work | Retry requires a transition ID. A completed matching retry returns current status without migration; a missing or superseded ID is rejected. | Node completed/stale/unauthorized retry tests and Client API forwarding tests. |
| F07: zone settings remain changed after removal | Activation captures the original settings and cache rules. Removal conditionally restores browser TTL, cache level, HTTPS enforcement, tiered settings, and rules. Already-restored values are safe to retry; conflicting external edits stop recovery. | Node `cdn-provider-state.test.ts`: enable/remove/repeat, partial restoration, external conflicts, failed provider reads/writes. |

Response delivery occurs after admission is released. A disconnected HTTP response cannot strand the transition or media-write lock; a regression exercises a response that never finishes.

Node startup preserves import, publishing, and streaming flags because a separate Client can still be running. Those flags clear on completion or explicit stop acknowledgement. Startup finalization skips streams that remain active. After an interrupted Client operation, an explicit stop may therefore be needed before another CDN change is admitted.

Recovery also verifies the public address, CDN flag, credentials, and managed identity against the saved intent. If the summary settings diverged after an interruption, it reapplies the intended settings and repeats media migration and invalidation before completion.

Provider snapshots retain editable rule references and exclude read-only rule metadata. Managed rules receive deterministic references so provider verification remains stable across retries. The field handling follows [Cloudflare's rule object documentation](https://developers.cloudflare.com/ruleset-engine/rulesets-api/json-object/).

The old service helpers that could configure/clear CDN outside the transition executor were removed. Enable, disable, and retry use the same phase executor and completion checks.

## Persisted state and API contracts

Client and Node must be updated together: transition-specific retries and direct-storage activity admission require the matching API changes in both repositories.

- `<node settings path>.cdn-private.json` stores the private journal. Its safe public projection is `cdnTransition: { id, targetEnabled, stage }`; private snapshots and recovery credentials are not included in that projection.
- `<node settings path>.remote-writes.sqlite` stores direct-storage activity. Active records do not expire merely because the Node or Client restarts.
- `POST /settings/cloudflare/retry` requires `{ "transitionId": "<saved ID>" }`. The Client proxy forwards that ID.
- Direct storage writes first call authenticated `POST /videos/:videoId/activity` with a UUID `activityId`. Their durable invalidation action carries that same ID to `POST /videos/:videoId/cache/invalidate`; successful invalidation closes the activity. Finished IDs have tombstones to prevent a delayed admission request from reopening them.
- Job admission checks both the summary pending flag and the private journal. If the summary flag is cleared but the journal completion write fails, jobs remain blocked.

## Deliberate repair cases

### Unknown original provider settings

An older installation may already have CDN enabled without a saved original provider snapshot, or may have only the earlier pending boolean with insufficient recovery information. The implementation cannot reconstruct unknown original Cloudflare settings or lost credentials. It refuses to claim completion, preserves recovery state, and requires repair using known original configuration; it does not assume that HTTPS/tiered caching should simply be turned off.

Do not erase the journal, pending flag, or public-address backup to suppress the panel. For an installation requiring repair, stop all work, preserve the settings and private state files, establish the intended original public address and zone settings, and repair the recovery record from that verified information. Provider conflicts must be reconciled explicitly before Retry can complete.

### Uncertain direct storage write after a Client crash

A direct S3 write can outlive a lost Client connection. A dead process or expired timer does not prove that the provider finished its write. Consequently, a `writing` action with an activity ID is not automatically replayed as completed after its owning Client dies. The activity remains a blocker until it is reconciled.

For operator reconciliation, first establish that all associated Client writers are stopped and the storage write has completed or been resolved. The active activity and video IDs can be inspected in the Node's private activity SQLite database (`writes` rows with `active=1`) and the Client's matching durable Node action. The existing authenticated Node invalidation endpoint accepts `{ "activityId": "<UUID>" }` for that video; omitting `paths` requests its normal full-video invalidation, and only successful invalidation releases the activity. Do not use that acknowledgement while a writer may still be running. Preserve/reconcile the matching Client action so it cannot later represent unfinished work as complete.

This is an explicit manual repair path for uncertain external work, not automatic lease expiry. Ordinary successful writes, failed admissions, canceled writes that drain, and ready invalidation retries finish automatically.

## Validation

- Final Node unit run: 3,389 tests passed with the required 100% coverage thresholds. The full database suites also passed: 61 SQLite tests and 58 PostgreSQL tests.
- Full Client run: 335 tests passed, 7 skipped, including import cancellation drain and pre-commit recovery direction labels.
- Both source typechecks passed. Source lint checks pass without errors; existing warnings remain.
- Additional focused tests passed after the final validator/type-annotation cleanup.
- Real Cloudflare account mutation and live AWS fault testing were not performed. Provider restoration was tested through intercepted HTTP responses; storage integration used the repository's Silo fixtures.

Deploy matching Client and Node versions together; live provider validation remains a release step.
