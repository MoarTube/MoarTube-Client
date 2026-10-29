# Local Windows integration and GPU runner

GitHub dispatches the manual `Local Windows Client-Node and GPU integration`
workflow to one Windows x64 PC with the `moartube-integration` runner label.
That PC executes the checks and uses its actual GPU drivers. GitHub receives the
logs, test reports, traces and screenshots. FFmpeg/Electron distribution build
workflows continue to use GitHub-hosted runners.

## One-time setup

Use a normal PowerShell terminal under the Windows account that uses the GPUs.
Node.js 24.22.1+, Git and a compiled Windows FFmpeg/FFprobe pair are required.
The local MoarTube Node must already be prepared and running at
`http://localhost:9090`. Viewer-rendering regression tests also read the static
assets of a MoarTube Node source checkout; they do not install or modify Node.

From the Client checkout:

```powershell
npm.cmd ci
npm.cmd run ffmpeg:build:windows  # Skip if already compiled.
npm.cmd run test:runner:setup
```

Setup downloads the latest official Windows x64 Actions runner, verifies the
SHA-256 digest published by GitHub, and extracts it into the ignored
`build/integration/runner` directory. It then runs GitHub's registration prompt.

Open [repository runner setup](https://github.com/MoarTube/MoarTube-Client/settings/actions/runners/new),
select Windows/x64, and enter its temporary registration token **at the local
runner prompt**. Do not paste the token into chat, commit it or store it in this
guide. The repository owner/admin must do this registration step. Keep the runner
name `moartube-windows-gpu`, the `moartube-integration` label and `_work` work folder.
Choose **No** when asked to install a Windows service. Running interactively gives
tests the same signed-in GPU session used by the desktop application.

The downloaded runner currently requires version 2.327.1 or newer for the Node
24-based Actions; leave automatic runner updates enabled. GitHub documents the
[registration process](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners).

Optionally configure repository Actions secrets `MOARTUBE_E2E_USERNAME` and
`MOARTUBE_E2E_PASSWORD` for the local Node's administrator account. Without them,
the existing tests use `admin` / `admin`.

## Start and dispatch

```powershell
npm.cmd run test:runner
```

Keep that terminal open and the PC awake. The launcher exports the absolute path
of this checkout's compiled `ffmpeg.exe` to the runner; `ffprobe.exe` must be beside
it. It also exports the adjacent `../MoarTube-Node` source directory. The runner
therefore uses the intended local dependencies even though GitHub checks the
Client out separately under `build/integration/runner/_work`.

For custom locations:

```powershell
npm.cmd run test:runner -- -FfmpegPath 'D:\tools\moartube-ffmpeg\ffmpeg.exe' -NodeSourceDirectory 'D:\projects\MoarTube-Node'
```

In GitHub Actions, select the local integration workflow, choose a trusted branch
and click **Run workflow**. Select `all` to require every adapter returned by
Client's GPU assessment, or select `amf`, `nvenc` or `qsv` to require that backend.
Multiple adapters of the selected backend are tested individually. A missing or
unavailable required GPU is a failure, never a CPU fallback or successful skip.
Hardware not present in this PC, including Intel when absent, is not certified.

This workflow is manual-only, has read-only repository permissions and does not
persist checkout credentials. Only dispatch trusted code: a self-hosted workflow
executes that code as your Windows account. Do not attach untrusted pull-request
triggers to this PC. The runner is registered only to this repository.

## What runs

1. Early prerequisite checks: native Windows x64, Node version, FFmpeg and
   FFprobe execution/hashes, GPU compressed-decode/scaling/encode probes, Node
   heartbeat, Node source assets and availability of Client port 8080.
2. Source, browser-test and integration-test typechecks; browser-test lint;
   Client, desktop and FFmpeg tooling unit tests.
3. Each required GPU runs the real generated publishing commands for MP4/HLS,
   live-filter processing, portrait/landscape scaling geometry, real loopback RTMP
   ingestion and live HLS output. Checks require the hardware decoder, GPU scaler,
   hardware frame format and H.264 encoder before execution. Output files are
   inspected/decoded; CPU frame transfers and software substitutions fail.
4. The complete existing browser suite runs with Chromium, Firefox and WebKit.
   Its real-Node journeys and viewer-rendering/memory fixtures retain their
   existing assertions and platform exclusions.
5. Each required GPU also runs Chromium publishing MP4/HLS and live journeys
   through the real Client UI. The fixture selects that exact adapter through
   Client Settings and asserts the server retains its selection. Viewer delivery
   and chat assertions remain in the live journey.

The workflow stops on the first failing stage. The browser suite retains its
existing first-failure limit and unsupported WebKit HLS exclusions on Windows.
A failure or an unexecuted stage does not establish coverage of later stages.
The local runner cannot certify Linux/macOS, absent adapters or every physical
desktop/driver combination.

## Run directly without GitHub

With Node already running:

```powershell
npm.cmd run test:e2e:install       # Once, to obtain the three browsers.
npm.cmd run test:integration:preflight
npm.cmd run test:integration      # The same complete gate used by the workflow.
npm.cmd run test:gpu              # Hardware pipelines only; no Node needed.
npm.cmd run test:gpu:e2e          # Browser GPU publishing/live journeys only.
```

Use `$env:MOARTUBE_INTEGRATION_GPU_BACKEND='nvenc'` (or `amf`/`qsv`) to require one
backend. Without the variable, every detected adapter is required. Direct runs use
the local compiled dependency unless an explicit absolute `FFMPEG_BIN` is set.
Set `MOARTUBE_NODE_SOURCE_DIR` if Node source is not in the adjacent directory.
Pass `MOARTUBE_E2E_USERNAME`/`MOARTUBE_E2E_PASSWORD` as environment variables for
non-default Node credentials. Treat browser traces/artifacts as test-account
diagnostics: they can contain authenticated requests and test content.

## Data and evidence

Managed runs start their own Client and refuse to reuse a process already on
port 8080. Each browser phase uses a fresh Client profile beneath
`build/integration/profiles/<run-id>`, leaving the developer's `data` directory
alone. Standalone `test:e2e` commands keep their previous reuse/data behavior.

The Node is the **real existing server**: tests create content and exercise its
settings through the application's UI, with the suite's existing cleanup. Node
is never provisioned, seeded, reset, stopped or replaced by the runner. Use the
Node instance and account you intend to test; external services, email, CAPTCHA,
network endpoints and storage remain that Node's configuration.

`build/integration/reports/integration.json` points to the latest run's unique
evidence directory. That directory records actual host/OS, FFmpeg/FFprobe paths
and hashes, requested/detected/selected GPUs, stage results, hardware commands,
verbose RTMP evidence and separate per-GPU browser reports. A partial run remains
marked failed. Historical run directories are retained locally rather than
mistaken for current results.

The general suite retains `playwright-report`, `test-results` and
`temp/e2e-client.log`. GitHub uploads those and the integration evidence with
14-day artifact retention even after an ordinary test failure. Cancellation may
prevent uploading diagnostics. Stop the interactive runner with Ctrl+C when it
should no longer accept jobs.

## Initial local verification (2026-10-29)

The new complete command passed source/E2E/integration typechecks, E2E lint,
164 Client unit tests (the two opt-in GPU cases are run separately), 10 desktop
unit tests (one Linux-only case excluded on Windows), 25 FFmpeg tooling tests and
the Client build. AMD Radeon Graphics and NVIDIA GeForce RTX 5080 each passed
both hardware tests, including publishing/geometry and real RTMP/live output.
Intel hardware is not present and is not qualified by this run.

The full browser run passed 12 cases, then failed at promotional-link visibility
on the Node viewer; 695 cases did not run under the existing first-failure limit.
A separate NVIDIA browser check passed both MP4/HLS publishing cases.
A separate AMD GPU browser run passed MP4/HLS publication, then failed because
the Node viewer's live-chat input stayed disconnected. These initial failures
were retained for diagnosis; see the subsequent repairs below. Later journeys
were not claimed as passed by those partial runs.

The official runner was downloaded and checksum-verified as v2.338.2. GitHub
registration and a remote workflow dispatch still require the repository
administrator's one-time registration token; downloading it alone does not make
the runner online.

## Integration repairs (2026-10-29)

The promotional-link test and other browse-page checks now navigate to Node's
actual `/videos` page; `/` is its separate index page. The apparent live-chat
failure was downstream of FFmpeg exiting with invalid pipe segment URLs before
the viewer opened. Live delivery now reads complete, atomically published HLS
files and uploads them serially. Hardware decoding/scaling/encoding remains
required. The reader caps file sizes, detects delivery falling behind its rolling
window, and stops on cancellation. Recording continues to archive every delivered
segment instead of retaining only the encoder's 20-segment window.

The original promotional-link and CPU live/chat cases passed together. All three
GPU browser journeys (MP4, HLS, live/chat) then passed on AMD Radeon Graphics and
NVIDIA RTX 5080, six passes in total. The full rerun also exposed an OGV test
waiting indefinitely for a native browser media document's response body. The
test now observes download versus navigation, verifies the actual URL/status,
and reads the same public source separately for the native-navigation byte
check. Actual downloads are inspected directly. Playback-control tests now use
the current player's accessible menus and buttons. OGV download and player
controls passed in Chromium, Firefox and WebKit (six targeted passes).

Reply creation now uses the viewer's contextual reply form; posting, reload
persistence and Client moderation passed in all three browsers. Permission
journeys keep a viewer open while the owner revokes access, so the server must
reject its stale controls. They also check that a refreshed viewer disables
those controls before the owner re-enables access, without bypassing the UI.
All four permission journeys passed in Chromium, Firefox and WebKit (12 targeted
passes), including real server rejection and successful use after re-enabling.

The HLS memory regression explicitly starts playback after deferred loading.
Its actual playback, seek, buffer limits and teardown checks passed in Chromium
and Firefox. Windows WebKit reports an explicit unsupported-HLS skip, matching
the other HLS journeys. The Client unit suite passed 170 tests; the two physical
GPU cases remain opt-in and run separately in the integration command.

Browser verification now accounts for all 708 cases: 699 have passing results
and nine have explicit Windows WebKit capability exclusions (eight HLS cases
and one generated H.264/AAC fixture). This combines the diagnostic continuation
with targeted current-source reruns; it is not a fresh single `test:integration`
execution. The continuation retained six failures from test versions loaded
before their repairs, all subsequently verified by passing targeted reruns.

`build/integration/reports/browser-verification-summary.json` records coverage,
the source reports, individual outcome history and the final verified result for
each case. Original failure traces remain available. The per-run
`integration.json` records the exact command mode and stages actually executed;
a successful GPU-only/browser run does not represent a complete gate run.

The final `test:gpu:e2e` invocation passed all six browser journeys against the
repaired delivery code: MP4 publication, HLS publication and real RTMP/live/chat
on AMD Radeon Graphics and NVIDIA GeForce RTX 5080. Its evidence is in
`build/integration/reports/runs/1793300540360-44568/`; both adapter profiles were
fresh and each required GPU was selected through Client settings.
