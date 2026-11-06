# CDN lifecycle audit and resolution approach

**Historical audit:** the findings below describe the pre-fix working tree. See [resolution notes](cdn-resolution-notes.md) for the subsequent implementation, permanent regression coverage, and repair limitations.

Date: 2026-11-05
Scope: CDN enable, CDN disable, recovery after failed enable, recovery after failed disable.
Baseline: Client `d84deaf`, Node `cf45869`, **including the uncommitted CDN implementation in both working trees**. References describe that working-tree version.
Disposition: audit and resolution design only; no production fixes applied.

## Result

Seven confirmed correctness defects remain: five P1 defects and two P2 defects. The first three were reported in the initial audit. The broader audit adds cross-worker settings loss, a restart gap in removal invalidation, unsafe stale retries, and incomplete restoration of zone settings.

This is a systematic repository and fault-injection audit. It covers the reachable implementation paths and the dimensions listed below. It does not claim to prove the absence of every possible bug. No live Cloudflare account was mutated. Provider mutations/rollback were mocked; actual configuration-file persistence, lock behavior, filesystem migration, browser behavior, and the existing database/S3 integration suites were examined or exercised as described below. The restart-gap probe reconstructs the persisted interruption state; it is not a live provider/process-kill experiment.

## Requirements used for the audit

- Activation always adopts the selected zone's root domain, HTTPS, and public port 443.
- Each new activation/configuration generates a fresh managed tunnel name. A retry resumes the saved identity; ordinary restarts retain it.
- Preserve the original public protocol/address/port once. Reconfiguration must not replace that original backup.
- Disable restores that public address. Do not discard the backup until removal is complete.
- Respect the separate tunnel preference: enabled means named with CDN on, quick with CDN off; disabled means stopped in either case.
- No importing, publishing, streaming, draining cleanup, or outstanding writes may overlap distribution changes.
- Whole-zone invalidation must cover every affected zone after the last relevant write, including recovery after restart.
- An incomplete transition persists, blocks jobs, and has a Settings recovery action. Success means all required work is complete.

## Audit coverage

| Area | What was examined | Evidence / limit |
| --- | --- | --- |
| Enable | Credentials, zone resolution, candidate validation, provider configuration, DNS, initial/final purge, settings save, address backup, media updates, tunnel reconciliation, completion save | Source tracing, existing lifecycle tests, 11 injected failure stages |
| Disable | Provider reset, initial purge, owned DNS restoration, settings restore, credential clearing, media updates, final old-zone purge, quick/stopped reconciliation, backup removal | Source tracing, existing lifecycle tests, 7 injected failure stages |
| Enable recovery | Saved identity, repeated media work, pending-purge drain, named/stopped readiness, job block, failure retention | Existing recovery tests and injected faults |
| Disable recovery | Saved restored address, retained backup, old credentials/outbox, repeated media work, quick/stopped readiness | Existing tests, injected faults, reconstructed restart boundary |
| Concurrency | Job admission versus transitions, overlapping toggles, concurrent settings writers, upload completion/cancellation, stale recovery requests | Real lock tests, actual settings persistence probe, upload controller probe, source tracing |
| Restart | Before settings commit, after commit, during migration, before final invalidation, before/after pending-state clearing | Source tracing, saved-state probes, existing restart-oriented tests; live process-kill matrix remains an acceptance requirement |
| Storage | Filesystem and S3 migration paths, master/rendition ordering, relative URL rewriting, managed-origin history, direct Client S3 writes | Existing filesystem/Silo tests and implementation review; live AWS/Cloudflare behavior not exercised |
| Databases | Shared service logic and both repository implementations | Full SQLite/PostgreSQL suites; new fault probes use controller/service fixtures rather than repeating every fault against both databases |
| Tunnel lifecycle | Named/quick/stopped policy, generated names, configuration fingerprints, provider admission, launch admission, DNS ownership/rollback recovery | Existing tunnel API/manager/runtime/ownership tests and source review |
| Client | Partial-save responses, failed/lost responses, persisted panel after refresh, saved-direction retry, disabled in-flight controls, desktop/mobile layout | Existing browser/API tests and full Client suite |
| Endpoint contracts | Authentication, status forwarding, no-store responses, saved-state fields, duplicate requests | Existing API tests and recovery source review |
| Cache journal | Durable credentials, target/token acknowledgement, backoff, previous-zone retries, periodic drain | Outbox/service review and existing invalidation tests; finding F05 concerns intent not yet enqueued |

## Confirmed findings

### F01 — P1: provider rollback failure has no durable recovery state

**Flows:** enable and disable before their settings commit; recovery from either failure.

The pending flag is written inside `updateCloudflareConfig` or `clearCloudflareConfig`, after provider changes have already begun. If a required provider operation fails and compensating rollback also fails, `withConfigurationRollback` raises an aggregate error. The controller's `settingsSaved` flag is still false, so it returns a generic failure without persisting recovery state. A process interruption before the settings commit has the same missing-intent problem.

**Observed:** both rollback-failure probes returned 400, left migration pending unset/false, and allowed job admission. The provider rollback failure itself was injected; the resulting controller and admission behavior was exercised.

**Impact:** Cloudflare and Node can disagree while imports, publication, and streams are allowed. The Settings panel remains hidden. The current Retry endpoint cannot reconstruct the attempted provider operation from the pending boolean alone.

**Sources:** [Node controller](../../../MoarTube-Node/src/controllers/settings.ts), lines 920–1100; [settings service](../../../MoarTube-Node/src/services/settings.ts), lines 366–410; [provider rollback](../../../MoarTube-Node/src/services/cloudflare.ts), lines 232–348.

**Resolution:** persist the intended transition and rollback information before the first external mutation. Keep it pending until verified completion or verified rollback. Record rollback failure as a recoverable phase, with the target configuration and source configuration available privately after restart. Derive the panel's direction from that transition record, not only the currently committed CDN flag.

### F02 — P1: activity flags do not exclude outstanding media writes

**Flows:** both toggles and both recovery directions.

Job admission checks importing/publishing/streaming flags and stopped-stream cleanup metadata. Upload handlers do not acquire a distribution activity lease or reject pending migrations. Client stop-publishing requests cancellation and immediately clears Node publishing state, without waiting for the publishing/upload promises to settle. Stop-importing also clears Node state before all work necessarily finishes. Direct S3 uploads bypass the Node upload handlers entirely. Startup clears activity flags without proving that a separate Client's writes have stopped.

**Observed:** an upload with cleared activity flags successfully invoked its write while the real distribution lock was held and migration pending was true. The legitimate cancellation/restart path into that state was traced in the Client and Node code; the probe did not simulate a real in-flight AWS upload.

**Impact:** a late upload can overwrite a migrated playlist or refill content after its final purge. The Node can report a successful transition while work still targets the old distribution configuration.

**Sources:** [Node upload handlers](../../../MoarTube-Node/src/controllers/videos.ts), lines 1529–1675; [Client stop publication](../../src/controllers/videos.ts), lines 364–397; [Client stop import](../../src/services/video-import.ts), lines 296–328; [direct S3 publication](../../src/services/video-publish.ts), lines 839–902; [startup activity reset](../../../MoarTube-Node/src/moartube-node.ts), lines 97–137.

**Resolution:** track work until it has actually drained. Cancellation requests must not immediately declare inactivity. Give Node media writes a lease covering their entire write/finalization/invalidation lifetime; acquire that lease atomically against distribution admission. Include destructive media mutations that can invalidate a migration's enumeration. Direct S3 work needs a Client-held operation/session lease and an explicit completion/cancellation acknowledgement. A Node restart must treat outstanding Client activity as uncertain until reconciled, rather than equating cleared database flags with inactivity.

### F03 — P1: another toggle can bypass an incomplete transition

**Flows:** primarily failed disable followed by enabling another zone; any attempted direction change while pending.

Configure and clear do not reject an already-pending transition. Their ordinary completion path clears pending without draining the previous transition's purge journal. Only the dedicated retry path explicitly calls `retryPendingPurges`.

**Observed:** after removal committed and its final old-zone purge failed, a configure request for another zone returned 200, cleared pending, and allowed jobs without calling the pending-purge recovery method.

**Impact:** the old zone can retain stale content while the Node declares recovery complete. The periodic purge task may eventually retry queued work, but that does not satisfy the completion invariant or protect against ongoing provider failures.

**Sources:** [configure/clear/retry](../../../MoarTube-Node/src/controllers/settings.ts), lines 920–1143; [completion](../../../MoarTube-Node/src/controllers/settings.ts), lines 1158–1189; [Client controls](../../public/javascript/settings-cloudflare-cdn.js), lines 37–157.

**Resolution:** reject new CDN configure/clear operations while a transition is pending, using the current transition ID and direction in the response. Disable the ordinary CDN toggle in the Client while pending; keep Retry available. Enforce the rule on the Node regardless of UI state. Route all successful completion through one verifier that includes every affected zone and outstanding required purge.

### F04 — P1: an unrelated stale worker write can erase recovery and address state

**Flows:** all four, including completion and later unrelated settings changes.

`Config.updateNodeSettings` merges a patch into the calling worker's cached settings and writes the entire JSON document. Many settings writers do not take the settings lock or reload within it. Atomic rename prevents a torn file, but does not prevent a stale worker from replacing newer fields. `fs.watch` delivers eventual notifications, not a write-serialization guarantee.

**Observed:** two objects using the actual `Config` persistence methods started with the same settings. One committed CDN/address/backup/pending fields. The stale second object changed only the Node name; the saved document lost the CDN state, backup, and pending flag. This models the interval before a worker receives its file-watch update; it does not run a complete clustered HTTP deployment.

**Impact:** new jobs can be admitted despite an incomplete transition; the original public address can be lost; the provider can remain configured while the saved CDN flag reverts.

**Sources:** [configuration merge/persistence](../../../MoarTube-Node/src/config/index.ts), lines 226–275; [unserialized identity writes](../../../MoarTube-Node/src/services/settings.ts), lines 218–239; [feature toggle writes](../../../MoarTube-Node/src/controllers/settings.ts), lines 1319–1407.

**Resolution:** make every settings write participate in one cross-process, reload-and-merge transaction. Reload inside the lock, validate the merged result, and atomically persist it. Add a revision/transition ID check for lifecycle completion. Updating only the CDN writers is insufficient. Keep the short settings-write lock separate from long provider work and IPC reconciliation to avoid lock inversion.

### F05 — P1: restart during removal can lose the final old-zone purge obligation

**Flows:** disable and recovery after failed/interrupted disable.

Removal purges once before settings commit. That successful purge acknowledges its outbox entries. `clearCloudflareConfig` then removes the zone and credentials. The required purge after media writes is scheduled later using the previous settings held only in controller memory. If the process dies after the commit but before that enqueue, neither settings nor the outbox necessarily retains a final purge target/credentials. Retry sees CDN disabled and has no old zone to add to its final purge set.

**Observed:** reconstructing that exact saved restart state allowed Retry to return 200 and clear pending without requesting an old-zone whole-cache purge. Source review confirms that outbox enqueue occurs only when the later purge call is reached. This probe models the interruption boundary; no live process was killed during a provider operation.

**Impact:** media rewritten after the initial purge can coexist with stale edge content, while recovery reports success. A periodic drain cannot recover an obligation that was never enqueued.

**Sources:** [removal ordering](../../../MoarTube-Node/src/controllers/settings.ts), lines 1053–1097; [final purge set](../../../MoarTube-Node/src/controllers/settings.ts), lines 758–780; [credential clearing](../../../MoarTube-Node/src/services/settings.ts), lines 400–410; [purge enqueue/acknowledgement](../../../MoarTube-Node/src/services/cloudflare.ts), lines 887–917.

**Resolution:** durably retain every affected zone and the credentials required for final invalidation before clearing public settings. Persist a distinct post-write purge obligation that cannot be satisfied by the earlier purge. Complete it after media writes and retain it across retries/restarts. Release private recovery credentials only after acknowledgement of the final obligation.

### F06 — P2: a stale Retry performs new work even after recovery completed

**Flows:** retry after either direction has already completed, such as from another stale Client page or a delayed duplicate request.

The retry endpoint does not require a pending transition or identify which transition is being retried. It repeats migration and purge work even when pending is already false. If that extra work fails, the error path reports a failure without establishing a persistent job block.

**Observed:** a retry after successful completion encountered an injected pending-purge failure, returned 502 with pending still false, and allowed jobs afterward.

**Impact:** a stale recovery action can introduce a new incomplete operation without a recoverable lifecycle state. It also has no protection against applying to a different transition than the one displayed by the Client.

**Sources:** [retry handler](../../../MoarTube-Node/src/controllers/settings.ts), lines 1115–1143; [Client retry request](../../public/javascript/settings-cloudflare-cdn.js), lines 37–106.

**Resolution:** make Retry transition-specific and idempotent. Under admission, compare the requested transition ID with durable state. Return the already-completed status without mutations for a completed matching request; reject a superseded request. Never rerun migration against an untracked transition.

### F07 — P2: disabling CDN leaves zone settings changed by activation

**Flows:** successful disable and its recovery.

Activation changes browser cache TTL, cache level, and Always Use HTTPS. `resetCdn` removes cache rules and turns tiered-cache settings off, but does not restore those three changed values. The provider rollback snapshot is temporary and is not retained as the original activation state.

**Observed:** an actual service enable/reset sequence, with HTTP calls intercepted, patched each of those three settings only during enable. Removal made no restoring request. This behavior predates the new recovery panel, but matters to the new public-address restoration flow.

**Impact:** CDN off does not restore the relevant zone behavior. In particular, a restored HTTP public address in the same proxied zone can still be forced to HTTPS. The resulting availability depends on that deployment's DNS/TLS/origin configuration; a universal outage is not claimed.

**Sources:** [activation settings](../../../MoarTube-Node/src/services/cloudflare.ts), lines 1091–1127; [reset](../../../MoarTube-Node/src/services/cloudflare.ts), lines 1137–1200.

**Resolution:** persist the original values of the zone settings MoarTube changes, restore them during removal, and retry that restoration as a provider phase. Restore owned changes conditionally so later external edits are reported as conflicts rather than overwritten. Avoid treating an unconditional tiered-cache `off` as restoration when the original setting was already on.

## Resolution design

### 1. Replace the single pending flag with a durable transition record

Keep a compatibility summary flag if needed, but use a private, versioned record as the authority. Store it before provider mutations, under distribution admission. It should contain:

- Transition ID, target enabled state, generation/revision, current phase, and last safe error category.
- Original public address and intended target address. Preserve the original pre-CDN backup across reconfiguration.
- Source/target zone identities, private recovery credentials, original changed provider settings, and owned DNS/resource references.
- Storage identity, relevant configuration revision, known media origins, and media migration checkpoint/verification state.
- Required final purge obligations per zone, with generation/token acknowledgement.
- Desired tunnel preference/identity and rollback state when compensation is necessary.

The Client should receive a safe status projection: ID, direction, phase, retryable state, and user-facing error. Do not expose private recovery credentials or raw provider errors in that status.

### 2. Use one executor for initial work and recovery

Both toggles create a transition; Retry resumes that transition. Do not maintain separate implementations with different completion checks.

| Phase | Required behavior before advancing |
| --- | --- |
| Admission | Serialize transition requests; require drained work and no competing transition. |
| Prepared | Durably store intent, source/target configuration, original backup, provider recovery data, and affected zones. Block new work. |
| Provider applied/restored | Verify the intended owned provider settings/DNS changes, or persist the exact incomplete rollback phase. |
| Node settings committed | Save the intended public address and CDN state without losing the transition record or original backup. |
| Media migrated | Finish required filesystem/S3 writes using recorded origins; preserve retryability after any partial write. |
| Final invalidation acknowledged | Purge every affected zone after the final writes. Earlier purges do not satisfy this phase. |
| Tunnel reconciled | Verify named/quick/stopped against the current transition identity and tunnel preference revision. |
| Complete | Recheck completion invariants under admission, durably mark complete, then allow jobs and release unneeded recovery data. Clear the public-address backup only after successful removal. |

The precise ordering of provider routing versus media work must preserve existing DNS ownership protections. A saved phase is not sufficient proof that a timed-out external action failed: retries must inspect owned resource state and safely repeat or reconcile it.

### 3. Close admission and persistence gaps first

Centralize settings writes (F04), enforce pending-transition exclusivity (F03/F06), then add full-lifetime activity admission (F02). All content-writing paths and stop/cleanup paths need a lock-order review. Use cross-process coordination, not an in-memory counter alone.

For direct S3 writes, a Node-only HTTP guard is insufficient. Client acknowledgement and operation/session fencing are required. If a Client still holds direct bucket credentials, merely expiring a Node lease does not prove that its writes have stopped. Keep uncertain work blocked until it is reconciled, or use a write path that the Node can actually fence. Decide this explicitly before claiming restart-safe inactivity.

### 4. Make completion one authoritative decision

All required provider work must be reconciled, media writes finished, every required final purge acknowledged, and the expected tunnel state confirmed for the same transition/revision. No helper should clear pending independently. A failed or uncertain required step leaves the transition pending and jobs blocked.

### 5. Update the Settings panel to represent the actual transition

Use the saved target direction, including failures before the CDN flag changed. Disable the ordinary CDN toggle while a transition is pending. Retry submits the transition ID and displays the latest safe phase/error. A stale page must refresh status on conflict; it must not start another migration. Hide the panel only after authoritative completion.

### 6. Handle existing installations explicitly

Existing pending installations have only a boolean and may already have lost old-zone credentials or original provider snapshots. Do not silently invent a completed phase. Recover information from the current settings, original-address backup, purge journal, tunnel ownership journal, and managed-origin history. If required data is unavailable, keep recovery incomplete and request the specific configuration repair needed. Do not discard the saved public-address backup to make the panel disappear.

## Regression and acceptance plan

Implement fixes with permanent tests asserting the desired behavior; the attached audit probes deliberately assert observed bad behavior and must not be adopted unchanged as regression expectations.

| Test family | Required cases |
| --- | --- |
| Four-flow baseline | Enable, disable, failed-enable recovery, failed-disable recovery with filesystem/S3, SQLite/PostgreSQL, and tunnel preference on/off. Local versus remote Client connectivity must not change Node semantics. |
| Failure injection | Every required provider step, DNS restore, settings save, media read/write, final purge, tunnel provision/start/stop/IPC, and completion save. Include both primary failure and failed compensation. |
| Interruption | Kill/restart at each durable phase boundary and around external actions: before request, provider accepted but response lost, before checkpoint, after checkpoint. Specifically kill after removal settings commit and before final purge enqueue. |
| Concurrent work | Slow filesystem upload, multipart request draining after cancel, direct S3 upload/cancel, stream drain, content deletion, Client disconnect, Node restart while Client is still writing. No migration overlaps writes. |
| Concurrent settings | Two processes on the same settings file; unrelated name/feature/account settings changes during each phase; no lost transition fields, credentials, backup, or unrelated patches. |
| Duplicate/stale requests | Same transition retry twice; completed retry; superseded retry; opposite toggle while pending; different-zone configure after failed removal. No untracked work or bypass. |
| Cache correctness | Initial purge succeeds, later writes occur, final purge fails; rate limit/backoff; old and new zones; restart with empty pre-final outbox; newer purge tokens survive acknowledgement of older work. |
| Provider restoration | Restore original cache/HTTPS/tiered values and owned DNS; preserve externally changed records; report irreconcilable ownership conflicts. |
| Client | Persisted pre-commit and post-commit failure panel; correct target label; retry without credentials/new name; in-flight controls; stale status conflict; lost response; responsive layout and safe error text. |
| Legacy recovery | Missing original backup, pending boolean without a transition record, unavailable recovery credentials, corrupted/unwritable journal, mismatched storage revision. Fail closed with an actionable status. |

Run live staging validation against a dedicated Cloudflare zone and test storage before considering provider recovery production-verified. Confirm actual account permissions/plan behavior, DNS propagation, certificate readiness, tunnel installation/connectivity, and provider timeout/rollback behavior. This audit does not report those untested conditions as confirmed bugs.

## Evidence and test execution

- [Audit probe source](cdn-lifecycle-probes.test.ts): 28 tests, comprising 8 bug-observation probes and a 20-case failure sweep. Both rollback directions map to F01, so the 8 observations represent 7 distinct findings.
- [Focused probe results](cdn-lifecycle-probes-results.txt): all 28 audit probes passed; the two isolated Node tests that had failed under full parallel load also passed. A passing observation probe confirms the undesirable state; it does not mean that defect is fixed.
- Final controlled-concurrency Client run: `npm.cmd test -- --maxWorkers=4` exited 0; **331 passed, 7 skipped**.
- Final controlled-concurrency Node run: `npm.cmd test -- --maxWorkers=4` exited 0; **3,405 unit tests passed** (3,377 existing tests plus 28 temporary audit probes), **61 SQLite tests passed**, and **58 PostgreSQL tests passed**. All required coverage thresholds passed.
- The temporary Node probe file was removed after execution. Its reproducible source and focused results are retained alongside this document. No production files were changed by the audit.

The first simultaneous Client/Node full-suite run encountered three load-sensitive failures: a Client mobile-layout coordinate assertion, a Node zero-delay timing assertion, and a Node dynamic-import timeout. Each passed when isolated. They are recorded as test-execution limitations, not additional confirmed CDN product defects.

To rerun the observation probes, copy `cdn-lifecycle-probes.test.ts` into the Node repository's `tests/unit/controllers/` directory and run:

```powershell
npx.cmd vitest run tests/unit/controllers/cdn-lifecycle-probes.test.ts --coverage.enabled=false
```

The fixture imports Node aliases and is intentionally stored outside the Client's normal test discovery. No provider credentials are needed. Remove the copied Node test after auditing, or convert it into proper failing regression cases when implementing the fixes.

## Recommended implementation order

1. Centralize settings persistence and add the transition ID/admission checks: F04, F03, F06.
2. Persist provider intent, snapshots, and post-write purge obligations before external changes: F01, F05, F07.
3. Finish full-lifetime write admission and Client cancellation/restart reconciliation: F02.
4. Consolidate execution/completion and connect the Settings panel to the durable transition record.
5. Pass the regression matrix, then perform live staging fault/restart validation.

These are corrections to the existing four flows, not additional CDN features. The current implementation should not be considered fully recovery-safe until the P1 findings are resolved.
