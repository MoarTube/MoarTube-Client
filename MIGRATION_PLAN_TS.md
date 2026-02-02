# MoarTube-Client JavaScript to TypeScript Migration & View Engine Update Plan

This document outlines the strategy for converting the `MoarTube-Client` codebase from an Express.js/JavaScript architecture to a Fastify/TypeScript architecture with Awilix for dependency injection, mirroring the `MoarTube-Node` standard. It also covers the migration of view templates from `dot` to `ejs`.

## Source of Truth
- Legacy code: `_src/`
- New code: `src/`
- Reference: `MoarTube-Node` (for style, DI patterns, and config)

## Phase 1: Foundation & Infrastructure
**Goal:** Establish the TypeScript application structure, Dependency Injection container, and basic server configuration.

1.  **Session Management**:
    -   *Action*: Install `@fastify/cookie` and `@fastify/session` (or `@fastify/secure-session`) to replace `express-session`.
2.  **Container Setup (`src/container.ts`)**:
    -   Initialize `Awilix` container.
    -   Create `registerServices` function to load modules.
3.  **Config Service (`src/services/config.service.ts`)**:
    -   Port `_src/utils/helpers.js` (configuration getters/setters) to a class-based `ConfigService`.
    -   Remove global state reliance.
    -   Implement methods to handle paths (`public`, `views`, `dist`).
4.  **Logger (`src/utils/logger.ts`)**:
    -   Port `logDebugMessageToConsole` to a structured logger (or use `pino` via Fastify, wrapping it for compatibility).
5.  **App Bootstrap (`src/app.ts` & `src/moartube-client.ts`)**:
    -   Create Fastify instance.
    -   Register core plugins: `cors`, `formbody`, `multipart`, `static`.
    -   Register `view` plugin with `ejs`.
    -   Initialize Awilix scope per request (`fastify-awilix` or manual hook).

## Phase 2: Core Services Migration
**Goal:** Convert utility scripts into injectable Services.

1.  **Node Communication (`src/services/node-api.service.ts`)**:
    -   Port `_src/utils/node-communications.js`.
    -   Convert logic to a class using `axios` (already installed).
    -   Inject `ConfigService`.
2.  **S3 Communication (`src/services/s3.service.ts`)**:
    -   Port `_src/utils/s3-communications.js`.
3.  **Handlers & Trackers**:
    -   Port `_src/utils/handlers/video-publish-handler.js` -> `src/services/video-publish.service.ts`.        -   Refactor `setInterval` logic into a managed `start()` method.
        -   Use private class properties for `inProgressPublishingJobs`.        -   Use private class properties for `inProgressPublishingJobs`.    -   Port `_src/utils/handlers/live-stream-handler.js` -> `src/services/live-stream.service.ts`.
    -   Port trackers in `_src/utils/trackers/` to `src/core/trackers/`.

## Phase 3: Controller & Route Migration
**Goal:** Convert Express routes and simple controllers to Fastify Routes and DI Controllers.

*Strategy*: Each module (Account, Home, Videos) will have a `*.controller.ts` (Class) and `*.route.ts` (Fastify plugin).

1.  **Home Module**:
    -   `src/controllers/home.controller.ts`
    -   `src/routes/home.route.ts`
2.  **Account Module**:
    -   `src/controllers/account.controller.ts` (Login, Register logic).
    -   `src/routes/account.route.ts`.
3.  **Videos & Streams Modules**:
    -   Port `videos.js` and `streams.js` logic.
    -   Adapt requests from `req.body/req.params` (Express) to Fastify types.
4.  **Remaining Modules**:
    -   `settings`, `links`, `monetization`, `reports`, `comments`.

## Phase 4: View Engine Conversion (Dot -> EJS)
**Goal:** Migrate template files and update syntax.

1.  **File Renaming**:
    -   Rename `public/views/*.dot` to `public/views/*.ejs`.
    -   **Important**: Copy `public/` to `dist/public/` is already handled by `tsup`, but we must ensure development mode reads from the correct location.
2.  **Syntax Conversion**:
    -   Convert Interpolation: `{{=it.x}}` -> `<%= it.x %>`.
    -   Convert Evaluation: `{{ it.x }}` -> `<% it.x %>`.
    -   Convert Conditionals: `{{? condition }}` -> `<% if (condition) { %>` ... `{{?}}` -> `<% } %>`.
    -   Convert Iteration: `{{~ it.arr :v:i }}` -> `<% it.arr.forEach((v, i) => { %>`.
    -   *Note*: Fastify View can pass data as `it` or merge into locals. We will stick to `it` property if possible to minimize checking, or map locals to `it`.

## Phase 5: WebSocket & Background Tasks
**Goal:** Ensure real-time features and intervals functionality.

1.  **WebSocket Server**:
    -   Port `ws` implementation from `moartube-client.js`.
    -   Integrate with `VideoPublishService` and `LiveStreamService`.
2.  **Background Intervals**:
    -   Ensure `performEncodingDecodingAssessment` and `startVideoPublishInterval` are called on app startup.

## Phase 6: Verification & Final Polish
1.  **Linting**: Ensure all new files pass `npm run lint`.
2.  **Testing**: Update `tests/` to verify critical paths (Authentication, Node API communication).
3.  **Cleanup**: Verify `_src` is no longer referenced in runtime.
