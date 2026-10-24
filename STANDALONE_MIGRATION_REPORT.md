# MoarTube Client standalone migration

The active Client communicates directly with the standalone Node. The `_src` reference tree is preserved unchanged.

- Removed Client index routes, controllers, request types, and Node API methods for add/remove/outdated index operations. The Client does not call Node's removed alias endpoint.
- Removed index table controls, index WebSocket event handling, backend terms acceptance, and the central CAPTCHA iframe/message flow. Video rendering no longer reads removed indexing fields.
- Replaced alias sharing with direct node watch/embed URLs and encoded social-share parameters. Facebook sharing no longer depends on a platform app ID.
- S3 thumbnail, preview, and poster uploads finish without the removed index-update callback. Filesystem image uploads still use the supported Node upload endpoints.
- Removed platform terms navigation and retired website guide links; remaining documentation links target the repository. Updated package homepage and README.
- Preserved authentication, direct node management, publishing/streaming, local processing, S3, and operator-configured Cloudflare/Turnstile support.

Regression tests cover removed routes, each filesystem/S3 image-upload branch, and rendered video-page script syntax. Manual transcoding/live-streaming and browser interaction have not been exercised. Direct S3 uploads do not have a separate image-cache invalidation endpoint in the current Node API; CDN cache expiration remains relevant.

Validation: source TypeScript checking, source ESLint, production bundling, and the standalone regression suite pass. Page coverage includes all eight EJS views and execution of video table-row generation with the standalone fields. The previous `_src` tree remains unmodified.

## Node ID retirement

Removed Node ID generation, settings controls, update endpoints, request types, and response/template fields from the active applications. Existing Node settings ignore the obsolete key and omit it on their next normal save. `_src` remains unchanged as reference code.
