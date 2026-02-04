# Refactoring & Completion Plan

This document tracks `TODO` items and placeholders identified in the codebase, prioritized by impact on functionality and stability.

## 1. Critical: Process Control & Reliability (Video Import)
*Refactoring the import process is required to enable "Stop Import" functionality, which is currently broken/unimplemented due to blocking synchronous calls.*

- [x] **Video Import Service** (`src/services/video-import.ts`): Refactor `importVideo` to use `spawn()` calls instead of `spawnSync` and implement a process tracking mechanism (e.g., a map of `videoId` -> `ChildProcess`).
- [x] **Video Import Service** (`src/services/video-import.ts`): Implement `stoppingVideoImport` to utilize the new process tracker to kill the active ffmpeg process.
- [x] **Video Import Service** (`src/services/video-import.ts`): Implement `stoppedVideoImport` to handle post-cancellation broadcasting cleanup.

## 2. High: Security & Privacy (Sockets)
*Current implementation broadcasts messages to ALL connected clients, leaking user activity.*

- [x] **Socket Service** (`src/services/socket.ts`): Implement user-specific socket mapping (map `userId` or `jwt` to `WebSocket`) to ensure `broadcastToUser` only sends data to the intended recipient.

## 3. Medium: Missing API Implementations
*These methods are currently empty placeholders in the newer TypeScript service but existed in legacy code.*

- [x] **Node API Service** (`src/services/node-api.ts`): Implement `uploadVideo` method (Multipart upload logic).
- [x] **Node API Service** (`src/services/node-api.ts`): Implement `uploadStream` method (Stream handling logic).

## 4. Low: Infrastructure & Verification
*Cleanup and configuration tasks.*

- [x] **S3 Service** (`src/services/s3.ts`): Refactor hardcoded `us-east-1` region to use a configuration value (Added support for `region` property in all S3 operations).
- [x] **Plugins** (`src/plugins/index.ts`): Verify Session Management (Session plugin correctly configured).
- [x] **Plugins** (`src/plugins/index.ts`): Verify Routes (Routes registration confirmed in `moartube-client.ts` and `routes/index.ts`).

## MoarTube-Node

*No explicit TODO comments found in `src`.*

**All Refactoring Tasks Complete.**
