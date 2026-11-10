import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  entry: ['src/moartube-client.ts', 'src/desktop-backend.ts'],
  format: ['esm'],
  target: 'node24',
  // Run before bundled dependency imports load on unsupported runtimes.
  banner: { js: "import '../bin/check-node-version.js';" },
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: true,
  splitting: false,
  treeshake: true,
  minify: false,
  skipNodeModulesBundle: true,
  external: [
    '../bin/check-node-version.js',
    // Keep native modules external
    'sharp',
    'systeminformation'
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
