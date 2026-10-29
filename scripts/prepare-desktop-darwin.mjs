import { requireDarwinTarget } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
requireDarwinTarget();
await import('./prepare-desktop-unix.mjs');
