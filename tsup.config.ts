import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  entry: ['src/moartube-client.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: true,
  splitting: false,
  treeshake: true,
  minify: false,
  skipNodeModulesBundle: true,
  external: [
    // Keep native modules external
    'sharp',
    'systeminformation',
    'ffmpeg-static' // Often better external if used
  ],
  esbuildOptions(options) {
    options.charset = 'utf8';
  },
  async onSuccess() {
    // Copy public folder (views, css, js, images, fonts) to dist folder
    try {
        cpSync('public', 'dist/public', { recursive: true });
        console.log('Copied public folder to dist/public');
    } catch (e) {
        console.log('No public folder to copy or copy failed', e);
    }
  },
});
