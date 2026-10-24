# MoarTube Client integration tests

These Playwright tests exercise **MoarTube Client through its UI against a real,
developer-run MoarTube Node at `http://localhost:9090`**. There are no mock servers,
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

## Test behavior

- Every workflow signs in using the Client form, targeting the real Node.
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

## Diagnostics and scope

Failures retain traces, screenshots, video, and uncaught browser errors. Open
`npm run test:e2e:report` or `npx playwright show-trace <trace.zip>`.
Real incompatibilities remain failing tests; they are never replaced by mock
responses, altered runtime behavior, relaxed success assertions, or `test.fail()`.

The previous 118-scenario/354-check result belonged to the removed mock-backed suite
and is **not** a real-Node integration result. Scenarios have been adapted to real UI
workflows; counts and outcomes must be taken from the current run.

Mock-only fault injection, artificial authentication expiry, raw HTTP upload
cancellation, synthetic socket reconnection events, automatic Node/database setup,
and request-only workflow shortcuts have been removed. Their old results do not
establish real integration coverage. Moderation destructive actions requiring
pre-existing viewer comments/reports, account changes, database restore, provider
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
- Live stream recording controls: at the desktop viewport, the sidebar intercepts
  pointer clicks on the recording checkbox in the live modal. The test uses normal
  clicks; it does not force the click, hide the sidebar, or set checkbox state using
  JavaScript. Actual streaming coverage requires the workflow to be usable first.

These are observations from the real Client UI. The suite does not label these cases
as expected failures or claim that a successful test discovery/type check validates
the integration.

Initial verification on 2026-10-24: the converted Chromium suite ran 70 scenarios
against the developer's running Node: 67 passed and 3 failed (the two wallet
deletions and the recording-control obstruction above). Type checks, E2E lint,
the existing Vitest test and the application build passed. Firefox and WebKit
remain selectable projects; only their wallet workflows have subsequently been
revalidated. The full 70-scenario suite has not been rerun following the wallet fix.
The report includes created-wallet addresses and created-video IDs so failed
workflows can be located without direct database cleanup.
