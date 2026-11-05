# Node, storage, CDN, and tunnel URL policy

Status: implemented and verified with focused regression tests and isolated public quick-tunnel playback on 2026-11-04. The URL blocker is resolved in the updated build. Milestone 6 remains open for full live named-account/CDN/storage transitions and remaining platform verification; this document does not claim those checks are complete.

## Problem and scope

A live quick-tunnel watch page returned HTTP 200, as did its heartbeat, player assets, HLS playlists, and a media segment when requested through the tunnel hostname. However, the rendered page, initial video sources, and stored playlists contained `http://localhost:9090` URLs. Browser inspection confirmed failed asset requests. Remote viewers consequently tried loading resources from their own machines.

The fix must support direct Node access with tunnels disabled, quick tunnels, named tunnels, filesystem storage, S3 storage, and existing CDN transitions. It must not replace an intentionally external S3/CDN media destination with the page's hostname. It must not solve a changing quick hostname by repeatedly rewriting the saved public Node address or every stored playlist.

This policy covers viewer pages, embeds, Node assets/APIs/WebSockets, media source URLs, HLS references, absolute share/metadata URLs, and distribution transitions. It adds no Client setting or display of generated quick-tunnel names. Existing lifecycle and authentication contracts continue to apply.

## Terms and precedence

| Term | Meaning |
| --- | --- |
| Viewer origin | The validated external protocol, hostname, and port through which the viewer reached Node. It may be localhost, a LAN address, a configured public address, or an active tunnel address. |
| Node-relative URL | A path served by the same Node as the page, such as `/external/resources/javascript/jquery-3.6.4.min.js`. It resolves against the viewer origin in a watch page. |
| Document-relative HLS reference | A reference resolved against the URL of the containing playlist, including its directory and any S3 bucket path prefix. It is not necessarily a root-relative path. |
| Configured Node origin | The address formed from `publicNodeProtocol`, `publicNodeAddress`, and `publicNodePort`; separate from the local listening address and tunnel state. |
| S3 media base | The configured provider endpoint/region and bucket, honoring virtual-hosted or path-style addressing. |
| CDN media base | The validated media hostname currently derived as `https://externalvideos.<publicNodeAddress>` for S3/CDN delivery. Filesystem media currently uses the Node hostname rather than automatically switching to this separate media hostname. |
| Ready tunnel origin | The HTTPS public URL of the connector that is actually running. The enabled preference, saved quick name, named display name, and remote UUID alone do not prove readiness. A named tunnel uses the configured Node hostname, not its display name as a hostname. |
| Canonical origin | The absolute public address chosen for sharing, embeds, and public metadata. It is deliberately distinct from the current viewer origin. |

Storage and CDN settings select the media destination. Tunnel state selects an available transport to Node. Viewer origin selects how the current page reaches Node. Canonical-origin policy selects which absolute address a link advertises. These decisions must remain separate.

## Core matrix

The matrix describes valid, committed configurations and eligible public media. An enabled tunnel is assumed ready in the access column; readiness, publication, and transition exceptions follow below. Direct access can coexist with a tunnel if the direct network route remains available.

| ID | Storage | CDN | Tunnels | Public route to Node | Node assets, APIs, and viewer media URLs |
| --- | --- | --- | --- | --- | --- |
| F00 | Filesystem | Off | Off | Configured direct address | Node assets/APIs and media use the viewer origin through Node-relative paths. |
| F01 | Filesystem | Off | On | Ready quick-tunnel HTTPS URL; direct access may remain available | Same as F00; the quick hostname is not stored inside media paths. |
| F10 | Filesystem | On | Off | Configured Cloudflare-proxied Node domain with a working direct origin | Same as F00; Cloudflare delivery applies when accessed through its proxied domain. |
| F11 | Filesystem | On | On | Configured Node domain through the ready named tunnel | Same as F00; local/direct access still follows its own viewer origin. |
| S00 | S3 | Off | Off | Configured direct address | Node assets/APIs use Node-relative paths; media uses the absolute S3 media base. |
| S01 | S3 | Off | On | Ready quick-tunnel HTTPS URL; direct access may remain available | Same as S00; the tunnel does not become an S3 media proxy. |
| S10 | S3 | On | Off | Configured Cloudflare-proxied Node domain with a working direct origin | Node assets/APIs use Node-relative paths; media uses the absolute CDN media base. |
| S11 | S3 | On | On | Configured Node domain through the ready named tunnel | Same as S10; named Node transport does not replace S3/CDN media delivery. |

For all eight rows, ordinary colocated references inside HLS playlists are document-relative. A remote S3/CDN playlist therefore keeps its child requests at that media destination; a Node playlist follows the address used to retrieve that playlist.

CDN and tunnel flags do not establish reachability by themselves. For F10/S10, direct origin routing, DNS, TLS, and firewall access must already work. Turning a named tunnel off stops its connector; it does not promise automatic DNS failover or create an alternate direct route. S3 media may remain reachable while the Node page is unreachable.

## URL creation rules

### Node pages, resources, and APIs

Use Node-relative references for Node-owned styles, scripts, images, watch/embed navigation, and API calls in Node-served pages. Do not embed the configured localhost/LAN address into a public tunnel response. Keep intentionally external resources external.

Use the viewer's origin for browser WebSocket connections: `wss` for HTTPS pages and `ws` for HTTP pages. Preserve existing authentication and authorization. CDN configuration must not force a local viewer to use a public domain just to retrieve Node-owned assets.

The same relative source string can be consumed outside a Node page, for example by the separate MoarTube Client or an API caller. Such callers must resolve it against the Node/API origin that supplied it, not against the Client's own origin. Audit and test those consumers before changing the source-response contract. If a consumer requires an absolute URL, resolve it explicitly in that context rather than persisting an origin into the media file.

The implemented `/external/videos/baseUrl` API returns an empty base for filesystem storage, and filesystem source API entries are Node-relative. The Client resolves both against its actual connected Node address, including IPv6/non-default ports, while retaining absolute S3/CDN URLs. Internal absolute config helpers remain available for provider/cache operations.

### Media entry URLs

For eligible filesystem media, build Node-relative top-level HLS, progressive-video, thumbnail, poster, and preview paths. For eligible S3 media, use the selected absolute S3 or CDN base and its correct object path. Choose live/static paths and available formats from actual video state; URL construction must not expose unpublished or withdrawn outputs.

Use URL/path operations that preserve encoding, bucket prefixes, non-default ports, IPv6 host brackets, and legitimate query parameters. Do not perform a global string replacement on arbitrary external URLs.

### HLS contents

Newly created, uploaded, published, and finalized playlists must use document-relative references for colocated media. Apply the same policy to existing playlist migration and to both filesystem files and S3 objects.

For the current layout, these examples resolve correctly from either Node or an S3/CDN base:

| Containing playlist | Reference | Resolved target |
| --- | --- | --- |
| `.../adaptive/m3u8/static/manifests/manifest-master.m3u8` | `manifest-360p.m3u8` | Rendition in the same `static/manifests/` directory. |
| `.../adaptive/m3u8/static/manifests/manifest-360p.m3u8` | `../../360p/segments/segment-360p-0.ts` | Segment under `.../adaptive/m3u8/360p/segments/`. |
| `.../adaptive/m3u8/dynamic/manifests/manifest-360p.m3u8` | `../../360p/segments/segment-360p-0.ts` | Segment in the same shared segment directory. |

Inventory the actual layout and all generated playlists before applying a transformation. Handle URI-bearing HLS tags as well as ordinary URI lines where those tags occur; preserve playlist syntax, media timing, live updates, and recording finalization. Key/init-segment tags are parser cases to audit, not a claim that encrypted/fMP4 playback is currently supported.

Existing absolute references may be converted only when they identify known managed media and the destination object relationship is established. Preserve intentionally external references. If a legacy origin or object mapping is ambiguous, report incomplete migration rather than guessing. A settings change must never leave a master advertising a rendition that has not been successfully prepared.

The implementation records previous Node/media bases in the non-secret, atomically written `_media_url_origins.json` before distribution changes. Keep it with Node data so a partially migrated installation can retry after restart. Existing filesystem playlists are also normalized while being served, without rewriting their stored files on GET. Known URI attributes are handled alongside ordinary URI lines, signed/query-bearing references remain unchanged, and old response validators cannot suppress the first normalized response. New live masters carry a `#MOARTUBE-LIVE` comment so relative references preserve live cache behavior through either URL alias; recording finalization removes the comment.

### Absolute share, embed, and metadata URLs

Use this precedence for a preferred public URL:

1. A valid configured non-local public Node origin. CDN-backed public Node links use the configured HTTPS domain. This expresses the configured public address, not a new guarantee of network reachability.
2. If no such configured public origin exists, the actual ready quick-tunnel HTTPS origin while CDN is off.
3. For a request-scoped link only, the validated viewer origin. If it is local/private, treat the link as local/private rather than advertising it as publicly reachable.

Never construct a public URL from a tunnel display name or UUID, or select a stopped/starting/failed quick connector as ready. Background work without a request may use only the configured public origin or a genuinely ready applicable tunnel origin; otherwise it must omit/defer public-link generation or return a clear unavailable result. Do not silently invent `localhost` as a public fallback.

An embed snippet needs an absolute iframe URL under this rule. Resources inside the embed follow the same Node/media rules as a normal watch page. Canonical metadata and public links must use the same chosen origin consistently. Automatic indexing of temporary quick-tunnel URLs is not added by this work; retain indexing opt-in and make any future ephemeral-address indexing policy explicit.

### External origin and proxy trust

Define and validate the accepted Node origins: configured direct/public origins, the actual current quick-tunnel hostname when applicable, the configured named hostname, and supported local access. Do not reflect arbitrary `Host`, `Forwarded`, or `X-Forwarded-*` values into absolute links or rendered metadata.

Trust forwarded protocol/host information only under an explicit trusted-proxy policy. Keep the browser-facing HTTPS origin separate from the connector's local HTTP origin. Unknown/untrusted host information must not become a canonical URL; reject it or use the validated configured origin as appropriate. Review the existing server-wide `trustProxy: true` behavior as part of implementation.

Fastify now trusts loopback proxies rather than all peers. Canonical selection does not reflect arbitrary forwarded headers. Stable configured public origins require no tunnel IPC lookup; read-only snapshots used for quick-origin selection time out after two seconds and fall back without starting a connector. Supported local/private request origins preserve mapped ports, and the share dialog identifies local-only links. Arbitrary proxy path-prefix hosting remains outside this contract.

Responses containing request/tunnel-specific absolute URLs must not be shared across incompatible origins through caches. Verify effective cache keys and invalidation; do not assume that a relative asset fix alone repairs cached HTML or metadata.

## Qualifications and exceptions

These qualify the eight rows rather than introducing more boolean matrix dimensions.

| Factor | Required behavior or boundary |
| --- | --- |
| Protocol, public port, local listener, native TLS | Keep local listening configuration separate from browser-facing protocol/port. Preserve non-default ports and avoid HTTP media in an HTTPS page. The URL change does not implement or repair TLS listener configuration. |
| Localhost/LAN/public access | Resolve viewer resources through the actual allowed access origin. Local/private access is valid but does not imply a shareable public link. |
| S3 endpoint, region, bucket, addressing style | Preserve the complete S3 media base. Document-relative playlist references must keep path-style bucket prefixes. CDN mode continues to enforce its existing hostname/bucket/endpoint compatibility validation. |
| CDN hostname and DNS ownership | Preserve the existing distinction between Node domain and S3 media domain. Do not overwrite S3 DNS with a tunnel route or infer new DNS failover from a URL change. |
| Live versus recorded media | Preserve dynamic/static manifest selection, updates, finalization, and distinct cache lifetimes. A playlist's origin independence must not freeze a live stream. |
| Publication and available outputs | Retain current publication/live source selection and withdrawn-rendition handling. URL normalization does not add private-media access control: raw public files/storage URLs and legacy source/watch APIs retain their existing access behavior. |
| Existing absolute playlists | Migrate known managed references in both local files and S3 objects. Retain safe retry and failure reporting; do not assume all historical files already follow the new convention. |
| Mixed locations during migration | Do not claim completion while media needed by the new URL is still available only at the previous destination. Preserve existing origin draining/rollback behavior and explicitly report partial completion. |
| CDN/browser caches | Invalidate affected playlists/pages after relevant changes and rollback. Avoid stale master/rendition pairs and stale origin-specific HTML. Preserve established live/VOD cache policies. |
| Tunnel off or unhealthy | Never enable/restart a connector merely to construct a URL. Preserve local/direct access and the user's disabled preference. Readiness is separate from desired configuration. |
| New quick hostname | New pages and public-link selection use the current ready connector. Stored relative playlists need no hostname rewrite. Previously shared quick URLs can expire and cannot be preserved by relative references. |
| Browserless/background callers | Require a validated configured/ready public origin for absolute public links; no arbitrary request-header or localhost fallback. |
| Cross-origin playback | Verify CORS, HTTPS, media types, and needed range behavior at S3/CDN/Node delivery endpoints. Relative playlist paths do not configure these services. |
| Turnstile | Continue existing enablement and credential rules. Domain authorization for direct/named/quick hosts is an external prerequisite; do not bypass a challenge or disable protection to make a tunnel work. |
| Private or signed URLs | The existing S3 presigning helper does not establish authenticated public HLS support. Child requests do not automatically inherit a parent URL's query signature. Preserve intentionally signed/external references; any protected multi-request playback design requires its own explicit contract. |
| Reverse-proxy path prefixes | Hosting under an arbitrary prefix such as `/moartube/` is not established by the current code review. Root-relative paths assume root-mounted Node. Do not claim prefix support or trust an arbitrary forwarded prefix; adding it requires a validated base-path contract across routes/assets/APIs/media/embeds. |
| `externalVideosBaseUrl` setting | Present in the schema but unused by the current URL builder. Keep it inactive for this work; do not introduce a new override/precedence rule accidentally. Making it active requires a separate explicit decision. |

## Transition and failure rules

| Event | URL/distribution requirement |
| --- | --- |
| Tunnel on/off with CDN off | Change transport availability and ready public-link selection only. Do not rewrite saved public settings or playlist origins. |
| Quick connector recreated | Use its current ready HTTPS origin for applicable new links; preserve direct access and relative playlist contents. |
| CDN enabled/disabled | Retain existing validation, owned-DNS restoration, credential commit, connector reconciliation, and rollback ordering. Select S3 versus CDN media entry URLs as appropriate. Do not reintroduce absolute origins into normalized playlists. |
| Filesystem/S3/provider/bucket change | Preserve the existing media migration contract, update top-level media destination and object availability, and normalize managed playlists. A storage operation may still need playlist work even when a hostname-only change no longer does. |
| Node public address/protocol/port change | Update applicable absolute public links and S3/CDN compatibility checks; relative Node/HLS paths should remain valid. Preserve needed cache invalidation. |
| New upload/publish/live finalization | Produce the new relative HLS convention at every creation/finalization path, with correct destinations and live/VOD semantics. |
| Failed save/provider change/migration | Preserve precommit state where rollback is promised. After commit, retain accurate saved-state/partial-failure reporting and retry incomplete distribution work; never claim successful playback or complete rollback without evidence. |

Disabling a tunnel while CDN remains enabled may leave a named DNS alias pointing to a stopped connector. Treat that as unavailable transport, not proof that a usable direct fallback exists. Any automatic failover would be a separate behavior change.

## Implementation inventory

Use these reviewed entry points to scope the next task; verify call sites and contracts before editing:

| Area | Node source |
| --- | --- |
| Public/resource/media URL selection | `src/config/urls.ts`, `src/config/index.ts`, `src/utils/cdn-settings.ts` |
| Viewer/canonical origin selection and managed playlist references | `src/utils/viewer-urls.ts`, `src/utils/hls-urls.ts`, `src/utils/media-url-origins.ts`; Client `src/services/node-api.ts` resolves Node-relative API media paths. |
| Node/watch/embed payloads and source construction | `src/controllers/node.ts`, `src/controllers/watch.ts`, `src/controllers/watch-embed.ts`, `src/controllers/video-controller-base.ts`, `src/services/videos.ts` |
| Viewer resource/API/WebSocket/share references | `public/views/node.ejs`, `public/views/watch.ejs`, `public/views/embed-video.ejs`, `public/views/embed-chat.ejs` |
| Public origin and forwarded headers | `src/plugins/index.ts`, request handling, HTML/metadata builders |
| Existing settings-triggered playlist migration | `src/controllers/settings.ts`, `src/utils/manifest-transform.ts` |
| S3 manifest publication/replacement | `src/services/storage.ts`, `src/services/videos.ts` |
| Upload/live/finalization paths | `src/services/video-upload.ts`, `src/services/streams.ts`, the Client's media-producing/upload code |
| Manifest/segment delivery and invalidation | `src/controllers/external-videos.ts`, `src/services/cloudflare.ts`, media-serving routes |
| Connector readiness and owned DNS | `src/services/cloudflare-tunnel.ts`, `src/services/cloudflare-tunnel-runtime.ts`, `src/services/cloudflare-tunnel-api.ts` |

## Implementation acceptance criteria

Checks below cover implementation, controlled filesystem/S3/provider tests, and the isolated public quick-tunnel smoke test. They do not replace milestone 6's live named-account/storage/CDN transition and cross-platform checks.

- [x] Cover all eight matrix rows with focused URL/source tests and verify public playlist/media destinations for each valid configuration.
- [x] Verify local/direct access with tunnels disabled and alongside an active quick tunnel; cover named-mode URL selection in controlled tests. Live named-account access remains milestone 6 work.
- [x] Remove unintended localhost/private origins from public watch/embed resources and filesystem media sources; verify Client/API consumers resolve relative sources against the correct Node.
- [x] Make master/rendition/segment references document-relative at every managed creation/publication/finalization path, preserving actual filesystem/S3 layouts and bucket prefixes.
- [x] Migrate existing managed absolute references on filesystem and S3 safely; preserve external/signed references or explicitly report unsupported/ambiguous cases.
- [x] Verify S3 virtual-hosted/path-style and configured CDN media routing without substituting the viewer/tunnel origin for external media.
- [x] Verify live updates, recording finalization, format/resolution availability, publication eligibility, playback, seeking, posters/previews, comments/chat, and embeds.
- [x] Implement and test absolute-link precedence, ready/disabled/failed tunnel handling, temporary-link expiry expectations, and browserless callers without inventing a public localhost URL.
- [x] Verify trusted-origin/proxy handling and cache isolation; untrusted Host/forwarded values cannot poison links or cached responses.
- [x] Verify storage/CDN/public-address transitions, partial migration, retry/rollback, and cache invalidation without undoing the tunnel enabled preference.
- [x] Keep unsupported path-prefix/private-HLS extensions and the inactive external-base override outside the promised behavior; document encountered prerequisites such as S3 CORS and Turnstile domain authorization.
- [x] Repeat the observed public quick-tunnel playback check from an external viewer context before removing the milestone 6 blocker; record the remaining named-account/platform checks separately.

See [implementation milestones](cloudflare-tunnel-milestones.md) and the [existing lifecycle contract](cloudflare-tunnel-contract.md). This implemented policy refines URL delivery; it does not mark milestone 6 complete or change the existing toggle/CDN design.

Implementation verification (2026-11-04): 598 Node tests across 20 files and 59 Client tests across nine files passed, with type checks, source lint (existing warnings), native builds, and the production Linux amd64 Docker build. An isolated browser verified public/direct watch and embed playback, seeking, assets/posters, canonical share links, and WebSocket connections with zero failed Node resources, wrong media origins, or script errors. Direct playback/local-only sharing survived tunnel disable; restart preserved off with zero connectors. Public playback worked after a fresh quick hostname without rewriting public settings or stored playlist bytes. Containers and anonymous volumes were removed after exit 0. Live named-account/CDN/storage-provider transitions and remaining platform execution are pending milestone 6; existing user processes were not restarted.

Audit follow-up (2026-11-04): the full suites passed (3,280 Node and 320 Client tests), with additional real S3 HLS checks. Recovery receipts now version the playlist convention, legacy encoder recovery is bounded to the original Node/video/rendition, known bucket prefixes normalize correctly, and local canonical links reject unrecognized private hosts. See the [audit report](cloudflare-tunnel-url-audit.md) for findings, regression coverage, smoke results, and remaining verification boundaries.
