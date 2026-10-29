import { requireDarwinX64 } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
requireDarwinX64();
await import('./prepare-desktop-unix.mjs');
