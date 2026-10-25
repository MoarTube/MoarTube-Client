# MoarTube Client and Node integration tests

The `Client-published m3u8 plays in the Node viewer` and
`starts and stops a real RTMP stream through the Client UI` cases run for WebKit
only on macOS. On other hosts they are explicitly skipped before their fixtures
run, because the Windows WebKit build lacks HLS/MSE support. The entire combined
live journey, including its chat assertions, is excluded for WebKit on those
hosts. Chromium and Firefox continue running both journeys on all hosts;
WebKit MP4/WebM playback and the other stream-dialog tests remain enabled.
This is a platform exclusion, not successful WebKit HLS verification on Windows.

These Playwright tests exercise **MoarTube Client through its UI against a real,
developer-run MoarTube Node at `http://localhost:9090`, followed by public viewer
workflows on that same Node**. There are no mock servers,
response interception, service replacements, direct database writes, fabricated
Node events, or application-factory test servers.

## Prerequisites

The developer starts and prepares MoarTube Node before running any tests. The suite
does not start, stop, reset, scaffold, migrate, seed, or configure that server or its
database. The Node must return its normal successful `/status/heartbeat` response.
If it cannot be reached, tests **error out** with an explicit prerequisite message.
The check is also a worker fixture so individual VS Code runs require the real Node.

Use whichever database the developer has configured on that Node: SQLite or
Postgres. Run the same suite again after changing the Node's database yourself.
The suite has no Postgres credentials or database administration code.

Sign-in defaults to `admin` / `admin`. For a Node with different credentials, set
`MOARTUBE_E2E_USERNAME` and `MOARTUBE_E2E_PASSWORD` in the environment. The Node host
and port are always `localhost:9090` and cannot be redirected to a fake service.

The Client is normally `http://localhost:8080`. Playwright reuses a running Client;
otherwise it runs the normal `src/moartube-client.ts` entry point with tsx. Its normal
settings, hardware detection, services and data directories are used unchanged.
`MOARTUBE_CLIENT_URL` can identify an already-running Client at another URL.

Viewer journeys require the real Node's comments, likes, dislikes, reports and live
chat features to be available. Human verification, external resource URLs, public
Node URLs, storage and browser media support remain the developer's responsibility.
The suite never disables CAPTCHA, supplies fake tokens, changes global configuration
to make a journey pass, or substitutes unsupported media playback. OGV is checked as
a real download; MP4, WebM and HLS must actually play in the selected browser.

All Playwright code resides in Client. No adjacent Node checkout, Node source
imports, Node package installation or third repository is needed to run it.

## Run

```sh
npm ci
npm run test:e2e:install
npm run test:e2e          # Chromium
npm run test:e2e:all      # Chromium, Firefox, WebKit
npm run test:e2e:ui
npm run test:e2e:debug
npm run test:e2e:headed
npm run test:e2e:report
npm run typecheck:e2e
npm run lint:e2e
```

On PowerShell installations that block npm.ps1, use `npm.cmd` / `npx.cmd`.
Run a single test using the VS Code Testing sidebar or:

```sh
npx playwright test tests/e2e/media.spec.ts --project=chromium --grep MP4
```

The root `playwright.config.ts` is discovered by the VS Code Playwright extension.
No test-only application startup is necessary. `npm test` remains the separate
Vitest runner.

## Failure isolation and cleanup

The suite stops at the first failure by default (`maxFailures: 1`) while integration
stability is being repaired. Later cases are reported as **did not run**, not as
passed. This prevents a dead Client from producing hundreds of connection failures.
For an intentional complete diagnostic run, explicitly override the limit:

```sh
npm run test:e2e:all -- --max-failures=0
```

No automatic Client restart or test retry is introduced. A real crash remains a
failure. Playwright still launches the normal Client entry point, and never manages
Node's lifecycle or database.

- Response, file-chooser and download observers register rejection handling when
  created. Their original promises still reject when awaited. If an earlier UI
  action fails, abandoned observers cannot raise unrelated unhandled rejections.
- A live-viewer failure still stops that test's stream through Client's Stop
  control, waits for its streamed state, and reaps the real FFmpeg broadcaster.
  Cleanup errors are attached separately without replacing the original failure.
- Video cleanup stops that video's active publish/stream job through Client before
  deleting its files. Viewer contexts close even if screenshots or diagnostics fail.
- Runner-managed Client stdout/stderr is retained in `temp/e2e-client.log`, with
  invocation boundaries. Failures attach its last 64 KiB as `client-process.log`.
  When reusing a developer-owned Client, retain that process's own logs as well;
  Playwright cannot capture output from a process it did not start.

The stability changes add no test scenarios and do not relax application success
assertions, rewrite requests, force clicks or replace services. The expansion counts
below are historical broad-run observations, not outcomes of the new default
first-failure run.

## Test behavior

- Administrator workflows sign in using the Client form, targeting the real Node.
- Viewer journeys use a separate browser context without administrator cookies.
  Their videos are imported/published through Client in the same test, never by
  depending on an earlier test, database seed or direct API upload.
- Imports, publishing, metadata, permissions, links, wallets, settings, moderation
  navigation, sharing, image uploads, downloads and stream controls use Client UI.
- Assertions observe visible results and real responses initiated by that UI.
  Tests never POST workflows through `request`, inject application state, or write
  media into the Client's source directory to bypass importing.
- FFmpeg creates real media input files in `test-results/`. A live-stream test uses
  FFmpeg as an actual RTMP broadcaster; the Client still processes that stream.
- Tests create uniquely named video/link/wallet content through the Client and
  delete their own content through the Client. Test-created records can remain
  when a genuine workflow fails; there is no hidden cleanup through Node or SQL.
- Name/about and feature-toggle tests restore their previous values through the UI.
- Tests never switch the Node's database, storage backend, network, account or TLS
  configuration, nor supply pretend cloud credentials.
- Tests run with one worker and no automatic retries because they share a real
  Client and Node. Avoid simultaneous runs against the same instance.

Use a Node whose content/settings the developer intends to exercise. This is a real
integration suite: changes happen in the developer's actual running Node, rather
than in an isolated imitation. SQLite/Postgres behavior is determined by that Node.

## Cross-application journeys

- `node-journeys.spec.ts`: Client publication to Node discovery/search/sorting/tags;
  actual MP4/WebM/HLS playback; OGV download bytes; shared embed playback; metadata
  propagation; comments, sanitization, replies and refresh; persistent reactions;
  per-video permissions; all report categories offered by the UI; active-report
  deletion and archival; archive deletion; optional report email; unpublishing;
  viewer theme, playback controls and mobile interactions.
- `node-moderation.spec.ts`: reports submitted on Node, content deleted from Client's
  report screens, and the viewer-visible result on Node.
- `streams.spec.ts`: real broadcaster to Client to Node playback, real WebSocket
  message delivery to another page, chat history after reload, and Client stop.
- Existing settings/link journeys now verify personalization and promotional links
  on Node as well as Client persistence.

A journey that fails at an earlier step does not establish coverage of its later
steps. Report/archive and comment-deletion failures remain failures; tests never
convert IDs, rewrite requests, fabricate archives or bypass the Client to proceed.
Test-created reports can remain when their deletion workflow is broken. Locate
records by the unique message shown in the trace. Videos are identified in the
`created-video.json` attachment. Cleanup uses only the normal Client controls.

## Diagnostics and scope

Failures retain traces, screenshots, video, and uncaught browser errors. Viewer
failures also attach `node-media-state.json` with source URLs, media errors and
browser codec capabilities, collected without changing player state. Open
`npm run test:e2e:report` or `npx playwright show-trace <trace.zip>`.
Real incompatibilities remain failing tests; they are never replaced by mock
responses, altered runtime behavior, relaxed success assertions, or `test.fail()`.

The previous 118-scenario/354-check result belonged to the removed mock-backed suite
and is **not** a real-Node integration result. Scenarios have been adapted to real UI
workflows; counts and outcomes must be taken from the current run.

Mock-only fault injection, artificial authentication expiry, raw HTTP upload
cancellation, synthetic socket reconnection events, automatic Node/database setup,
and request-only workflow shortcuts have been removed. Their old results do not
establish real integration coverage. Account changes, database restore, provider
operations, TLS transitions and long-duration/hardware matrices are not yet covered
by this ordinary run. Starting a Node with Postgres does not by itself test database
switching or backup restoration.

CI is manual on a self-hosted runner labelled `moartube-integration`, with a Node
already prepared at localhost:9090 by its developer. The workflow never provisions
the Node or Postgres. Browser/report tooling from the earlier suite is retained.

## Real integration failures observed during conversion

- ETH/BNB donation address deletion originally failed because the Client sent a
  numeric `cryptoWalletAddressId` while its route required a string. The Client
  route, controller and Node API service now consistently use positive integer IDs,
  and its wallet response type matches the Node's `wallet_address_id` field.
  Both deletion workflows passed against the real Node in Chromium, Firefox and
  WebKit (6 targeted checks) on 2026-10-24. Tests also assert the actual UI request's
  numeric ID and verify deletion remains effective after reload. Addresses left by
  runs before this fix can remain on the Node.
- Live stream recording controls originally failed because the sidebar's z-index
  placed it above the dialog. The sidebar now sits below modal backdrops, and the
  live dialog uses a bounded responsive width, wrapping resolution choices, and
  standard switches with associated labels. Normal checkbox clicks, label clicks,
  keyboard toggling and dialog bounds passed at 1280x720, 1920x1080 and 390x844 in
  Chromium, Firefox and WebKit. The real RTMP start/stop workflow also passed in
  all three browsers (15 targeted checks total) on 2026-10-24. These tests never
  force clicks, hide the sidebar or inject checkbox state.

These are observations from the real Client UI. The suite does not label these cases
as expected failures or claim that a successful test discovery/type check validates
the integration.

Initial verification on 2026-10-24: the converted Chromium suite ran 70 scenarios
against the developer's running Node: 67 passed and 3 failed (the two wallet
deletions and the recording-control obstruction above). Type checks, E2E lint,
the existing Vitest test and the application build passed. Subsequent verification on 2026-10-24 after the wallet and live-dialog fixes:
the complete Chromium suite passed all 73 scenarios (including three added
viewport regressions). All 15 targeted stream checks passed across Chromium,
Firefox and WebKit. E2E typechecking, E2E lint and the application build also passed.
The complete Firefox and WebKit suites have not been rerun.
The report includes created-wallet addresses and created-video IDs so failed
workflows can be located without direct database cleanup.


## Viewer expansion findings

The viewer journeys expose genuine application incompatibilities; none are marked
as expected failures or skipped:

- Node's watch-page report form offers `complaint`, but Node's request schema
  rejects it. Both video and comment report journeys retain this failure.
- That form labels email as optional, but Node requires a valid email and rejects
  the empty string for both video and comment reports.
- Client report archive/delete controls send numeric `reportId` values, while
  Client's routes require strings. Valid reports can reach the moderation table,
  but those operations fail before reaching Node. Archive deletion remains blocked
  behind successful archival; no archive is fabricated for testing.
- Client comment deletion has the same numeric `commentId` versus string-schema
  mismatch, including deletion from the comment-report screen.
- During the full run, Client search returned HTTP 500 while cleaning up a live
  video and raised an uncaught browser error. The browser audit retains that
  intermittent failure rather than ignoring it.

The existing historical results above predate this expansion. Current totals and
browser outcomes are recorded in the Playwright report; a successful earlier run
must not be presented as validation of these newly added journeys.


## Expansion validation on 2026-10-24

The suite now contains 109 scenarios (327 browser cases), adding 36 scenarios to
the previous 73. The broad three-browser development run completed 324 executions:
249 passed and 75 failed, with none skipped. Focused runs then checked corrected
test interactions and the additional sanitized-comment regression.

Latest observations for every current scenario, combined across those runs:

| Browser | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Chromium | 91 | 18 | 0 |
| Firefox | 91 | 18 | 0 |
| WebKit | 89 | 20 | 0 |
| Total | 271 | 56 | 0 |

This table combines observations; it is **not a single fresh full-matrix run**.
The original broad-run report is preserved in `playwright-report/` and
`test-results/results.json`. Follow-up JSON reports/logs and the explicit aggregate
are in `temp/e2e-*.json`, `temp/e2e-*.log` and
`temp/e2e-validation-summary.json`. Typechecking and E2E lint passed.

At the time of that historical run, blockers included the report category/email contracts and
Client numeric comment/report IDs described above. WebKit HLS VOD and live playback
remain stalled with no selected media source; ordinary MP4, WebM, embedded playback
and playback controls passed. The WebKit comment-dialog cancellation check remains
failing before deletion and needs investigation. Archive deletion is implemented
as part of the archive journey, but cannot be reached while archival is broken.

Sanitized comments containing Unicode, ampersands and HTML tags passed their final
Node-to-Client search checks in all three browsers. One earlier attempt was blocked
by an unexpected Client exit during import/search setup; restarting the normal
Client allowed verification. The suite did not reset Node or rewrite any requests.
Intermittent search/navigation errors observed earlier remain in the retained
reports and are not claimed fixed by later successful checks.


## Stability verification on 2026-10-24

No scenarios were added for this repair. The existing WebKit RTMP/viewer test was
repeated four times against one normally started Client and the real running Node.
All four retained their genuine HLS playback failure, and all four attached proof
that Client's Stop control completed: the row became streamed and its Stop control
was removed. The broadcaster processes were reaped.

Without restarting that Client, three existing Chromium tests then passed:
sign-in/session/sign-out, poster upload, and sanitized-comment search after real
import/publication. The supervised process recorded no unexpected Client exit;
it was stopped intentionally only after both phases finished. This validates that
failure path, not a claim that every earlier unexplained exit has been diagnosed.
Artifacts are in `temp/e2e-owned-*.json`, `temp/e2e-owned-*.log` and the corresponding
HTML report directories.

A separate default-limit check retained the real numeric-comment-ID failure,
reported the next two cases as did not run, and attached Client process logs.
Its artifacts are `temp/e2e-stability-failfast.*`. No application validation errors
were changed into expected failures or successful outcomes.

## Moderation repair validation on 2026-10-24

Client now accepts the numeric comment, report and archive IDs sent by its UI,
and preserves those numbers when forwarding JSON to Node. Twelve existing
Chromium moderation journeys passed after this repair, including comment/reply
moderation, report permissions, copyright/other report archival and deletion,
archive deletion, and deleting reported content. Client remained running during
that supervised run; it was stopped intentionally afterward. Artifacts are
`temp/moderation-owned-client-fixes.json` and
`temp/moderation-owned-client-events.json`.

The sibling Node source now accepts the viewer's complaint category and optional
blank report email. Its 229 targeted existing validator/controller unit tests
and TypeScript check passed. The targeted assertion run used
`--coverage.enabled=false`; it does not establish whole-project coverage.
Client's six unit tests, application/E2E TypeScript checks, build, and lint of the
changed application source passed.

The subsequent real-browser run passed two Chromium journeys, then stopped on
the complaint report because the developer-run Node still returned its old
category validator. The remaining 51 cases did not run. Node must be reloaded
by the developer before the complaint/email fixes can be verified end to end.
Client stayed alive throughout this run. Artifacts are
`temp/moderation-recheck-client-fixes.json` and
`temp/moderation-recheck-client-events.json`. These focused results do not replace
the historical full-suite totals or establish that all unexpected exits are fixed.

After the developer restarted Node with the saved changes, all 54 targeted
moderation cases passed in one run: 18 each in Chromium, Firefox and WebKit.
This includes complaint reports, blank optional emails, archive creation and
deletion, report deletion, reported-content deletion, report permissions, and
the comment/reply journey with delete-confirmation cancellation. The previous
WebKit cancellation failure did not reproduce in this run. No cases were
skipped or retried. The same supervised Client stayed alive for the entire run
and was stopped intentionally only after completion. Artifacts are
`temp/moderation-reloaded-client-fixes.json`,
`temp/moderation-reloaded-client.log`, and
`temp/moderation-reloaded-client-events.json`.

A read-only capability check of the installed Playwright WebKit on this Windows
machine reported `MediaSource` and `ManagedMediaSource` as undefined, no native
HLS support (`canPlayType('application/vnd.apple.mpegurl') === ''`), and progressive
H.264 support as `probably`. This explains why the existing HLS VOD/live playback
checks cannot decode HLS in this environment. Those scenarios remain unchanged
and failing; they are not skipped, mocked, or replaced with manifest-only checks.
The diagnostic script is retained in `temp/check-webkit-media.mjs`.

## Full-suite rerun on 2026-10-24

All 327 browser cases received completed results against the developer-run real
Node. This required two segments because Client exited unexpectedly after 138
completed cases in the initial run. The supervisor stopped the runner immediately
and preserved its logs; it did not continue against a dead server. Only the 189
unfinished cases were selected for the separate continuation. Completed failures
from the first segment were retained. No test scenarios, assertions, or application
code were changed during this rerun; no retries or skips were used.

| Browser | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Chromium | 108 | 1 | 0 |
| Firefox | 107 | 2 | 0 |
| WebKit | 106 | 3 | 0 |
| Total | 321 | 6 | 0 |

Failures:

- Chromium embedded-player sharing: decoded playback progress did not exceed
  0.2 seconds within the polling timeout.
- Firefox MP4 and OGV publication: the Client browser audit caught
  `NetworkError when attempting to fetch resource.` in each case. These are
  uncaught UI errors; their traces do not identify a source location.
- WebKit HLS VOD and RTMP live viewing: the Play control remained invisible.
  The earlier read-only browser capability diagnosis remains relevant. The live
  test attached successful UI cleanup proof (`streamed`, Stop control removed),
  and subsequent tests continued to pass.
- WebKit Node About editing/restoration: the Client browser audit caught an
  access-control error for `/videos/search`.

The initial Client process exited with code `3221226505` (`0xC0000409`) at
21:30:44 America/New_York. Its application log ends without a JavaScript fatal
stack. Its cause was unresolved at that stage; see the native crash investigation
below. The
continuation Client remained running through completion and was then stopped
intentionally by its supervisor. These are completed suite observations across
two segments, **not a successful uninterrupted full-suite run**.

The combined, deduplicated results and process events are in
`temp/e2e-full-summary.json`; all 327 case outcomes are in
`temp/e2e-full-cases.json`. The initial log and process history are
`temp/e2e-full-rerun.log`, `temp/e2e-full-rerun-client.log`, and
`temp/e2e-full-rerun-events.json`. The continuation JSON report and process logs
are `temp/e2e-full-continuation.json`, `temp/e2e-full-continuation-client.log`,
and `temp/e2e-full-continuation-events.json`; its HTML report is in
`temp/e2e-full-continuation-report/`. Failure traces and screenshots are retained
under `test-results/full-rerun/` and `test-results/full-continuation/`.

## Native crash investigation on 2026-10-24

The `0xC0000409` exit reproduced while repeating the existing Firefox media and
navigation specs against the real developer-run Node. Microsoft ProcDump was
attached to the normal Client process, with no application/test changes or JIT
workarounds. On installed Node.js 24.15.0 (libuv 1.51.0), Client crashed after
five completed cases, approximately 27 seconds after startup. ProcDump captured
a full native dump. `--report-on-fatalerror` did not produce a Node report.

The matching official Node 24.15.0 symbols resolve the exception as
`__report_gsfailure+0x1d`, with parameter `0x2`
(`FAST_FAIL_STACK_COOKIE_CHECK_FAILURE`). The faulting thread's stack includes:

```text
node::TCPWrap::Connect6
node::TCPWrap::Connect<sockaddr_in6>
uv_tcp_connect
uv__tcp_connect
__report_gsfailure
```

This matches the confirmed Windows TCP-connect runtime defect in
[Node issue 63620](https://github.com/nodejs/node/issues/63620).
libuv passed an uninitialized `OSVERSIONINFOW` structure to `RtlGetVersion`.
The correction initializes its size and service-pack string before the call:
[libuv fix 5107](https://github.com/libuv/libuv/pull/5107).
Node incorporated that fix in 24.16.0 through
[Node PR 62561](https://github.com/nodejs/node/pull/62561).
Repeated Client integration traffic exercises this native connection path.

The recommended runtime is the current Node 24 LTS patch release,
[24.22.1](https://nodejs.org/en/blog/release/v24.22.1). A checksum-verified portable
copy was downloaded into `temp/` for comparison. Only Client's executable changes
in the comparison; Playwright still runs on the installed 24.15.0, the real Node
server remains developer-managed, and the existing specs and assertions are
unchanged. The installed Node executable and system PATH have not been modified.

Evidence is retained under `temp/crash-investigation/`: `baseline-2/events.json`,
`baseline-2/procdump.log`, `baseline-2/node.exe_261024_215947.dmp`, and the matching
`.analysis.txt` (symbolized debugger output). The comparison logs and results are
under `node-24.22.1/`.

Comparison result: all 69 selected executions completed (the same 23 existing
Firefox media/navigation scenarios repeated three times). Client stayed alive
through the 3.6-minute run, ProcDump captured no native exception, and Client was
stopped intentionally afterward. There were 68 passes and one failure: the
WebM publication case caught the existing uncaught UI
`NetworkError when attempting to fetch resource.` This remaining browser error
is not claimed fixed by changing the runtime. No cases were skipped or retried.
The full 327-case matrix has not been rerun on 24.22.1.

Upgrade the installed Node runtime before the next full-suite verification so
Client and Playwright processes both use a fixed release. The portable comparison
supports that remedy for the captured native crash; it does not establish that
every remaining browser test failure has the same cause.

## Playback and browser-error repairs on 2026-10-24

The remaining non-HLS failures had three separate causes:

- Node's vendored `public/javascript/videojs-landscape-fullscreen.min.js` made
  an unused, unconditional fetch of its own CDN copy. When Client's real share
  iframe loaded that plugin, a failed/cancelled CDN request produced an uncaught
  `NetworkError`. The local asset now omits that fetch while retaining plugin
  registration and behavior. This is a Node production-asset change; no test
  routing, interception, or error filtering was introduced.
- Client's video-list ready callback could start an XHR after navigation had
  begun. WebKit reported that as an access-control error in the About-settings
  journey. The video page now stops its loaders and pending search requests at
  `beforeunload`/`pagehide`, guards late callbacks, and resumes loading after a
  persisted `pageshow`. Loader interval rejections are handled and show a real
  error in the active UI. The browser audit continues to assert no uncaught errors.
- The embed journey clicked its actual overlay Play control and then let the
  shared playback helper issue another Play click while startup was pending.
  It now tells the helper playback has already been requested. Assertions still
  require decoded media, elapsed playback time, and no media error.

Existing targeted checks passed: all four Firefox publication formats repeated
three times (12 executions), WebKit About edit/restore repeated ten times, and
Chromium embedded playback repeated ten times. No scenarios were added, skipped,
or retried. An earlier pagehide-only cleanup attempt retained a real WebKit
failure and was refined to stop loading earlier at beforeunload; that failed
attempt remains in its own report. Client stayed alive during these checks.
Artifacts are `temp/e2e-other-fixes-publication.json`,
`temp/e2e-other-followup-navigation.json`, and
`temp/e2e-other-followup-embed.json`, with corresponding process logs/events.

Client's six unit tests, application/E2E typechecks, E2E lint, build, and videos
template compilation passed; Node's modified plugin passed its JavaScript syntax
check. These focused checks do not replace a full 327-case run.

The first broader recheck (`temp/e2e-other-matrix.json`) still caught a Firefox
publication network error because Node was serving the old asset from
`dist/public`. The developer then rebuilt and restarted Node; both source and
built assets now omit the unused self-fetch. Passing the earlier Firefox repeats
alone did not establish that the served asset had been updated.

The fresh three-browser recheck against that rebuilt Node completed all 57
selected cases: **55 passed, 2 failed, 0 skipped, 0 retries**. Chromium and Firefox
passed all 19 cases each; WebKit passed 17 and retained its HLS VOD/live failures.
All four previously reported non-HLS failures passed. Navigation, all four
publication formats, embedded playback and About editing/restoration passed
across all three browsers. The full 327-case matrix has not been rerun after
these repairs.

Both remaining WebKit failures retained `currentSrc: ''`, `readyState: 0`, and
empty native HLS capability in the media diagnostics, consistent with the earlier
Windows WebKit capability investigation. Their assertions remain unchanged and
the cases are not skipped. The live case attached successful UI cleanup proof
(`streamed`, Stop control removed). The same Client process remained alive for
the whole check and was stopped intentionally afterward. Final artifacts are
`temp/e2e-other-final-matrix.json`, `temp/e2e-other-final-matrix-events.json`,
the corresponding HTML report/logs, and `test-results/other-final-matrix/`.

## Live-chat delivery investigation on 2026-10-25

The latest WebKit stream failure occurred at the second viewer's live-chat
assertion, before HLS playback. It reproduced in three existing real integration
executions. Passive WebSocket diagnostics recorded two successful chat joins,
one outgoing chat message, and only one incoming message broadcast per execution.
The sender displayed its own message while the observer remained empty. Stream
cleanup succeeded in each case. The same existing journey passed once in Chromium.

Node's chat handler invokes `HandlerContext.broadcast`, but
`src/websocket/websocket-manager.ts` implements that context using only its local
worker's socket collection. Node forks a worker per CPU. The cluster master and
worker already handle `websocket_broadcast_chat` IPC, and
`ClusterWorker.broadcastChatToAllWorkers` already sends it, but handler broadcasts
are not wired to that path. This prevents delivery to viewers on other workers;
browser-specific connection placement can expose it. The original trace's
history requests completed before message submission, so initial history loading
does not explain that captured failure.

The repair injects a cluster broadcaster into the manager used
by `ClusterWorker`, routes handler broadcasts through master IPC, and lets each
worker's IPC response handler deliver locally exactly once. Standalone managers
retain local delivery. The two-file Node fix was applied on 2026-10-25 in
`src/websocket/websocket-manager.ts` and `src/core/cluster/worker.ts` after user
authorization. The original proposed patch is retained in
`temp/node-chat-cluster-fix.patch`.

During investigation, passive failure diagnostics were added to the Client E2E fixture. They
record selected protocol fields and socket IDs, excluding authentication and
Turnstile tokens. No live workflow, assertion, skip, routing, or server
configuration was changed. E2E typechecking and fixture lint passed.
Artifacts: `temp/e2e-live-investigation.json` (three WebKit failures),
`temp/e2e-live-control.json` (one Chromium pass), and
`node-websocket-events.json` attachments in the failure report.
The separate Windows WebKit HLS limitation still applies later in this journey;
skipping the entire live test would also discard its RTMP and chat verification.

After application, Node's typecheck, lint of both modified files, and 193 existing
WebSocket manager/chat-handler/cluster-worker/IPC unit tests passed. The targeted
unit run disabled whole-project coverage collection; it does not establish full
project coverage. Client's E2E typecheck and touched-test lint passed. The existing
live scenario now also asserts exactly one message in each viewer to detect
duplicate delivery.

The developer rebuilt and restarted Node, then the existing real live scenario
ran three times in each browser: six full passes (Chromium/Firefox) and three
WebKit failures at the later HLS Play-control check. All nine executions passed
chat delivery, exactly-once rendering and history reload. Each WebKit diagnostic
recorded one outgoing message and two incoming copies on two distinct viewer
sockets, compared with only one incoming copy before the fix. All three WebKit
failure cleanups completed with `streamed` state and the Stop control removed.
No retries, skips or mocks were introduced for this verification. Artifacts are
`temp/e2e-live-cluster-fix.json`, its corresponding HTML report/log, and
`test-results/live-cluster-fix/`. The full 327-case suite has not been rerun for
this Node repair.
