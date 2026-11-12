import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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
    // Keep packages with runtime asset/worker lookup external.
    '@imagemagick/magick-wasm',
    'systeminformation',
  ],
  esbuildOptions(options) {
    options.charset = 'utf8';
  },
  async onSuccess() {
    execFileSync(process.execPath, ['scripts/verify-image-assets.mjs'], { stdio: 'inherit' });
    cpSync('src/utils/image-runtime', 'dist/image-runtime', { recursive: true });
    // Copy public folder (views, css, js, images, fonts) to dist folder
    try {
      cpSync('public', 'dist/public', { recursive: true });
      console.log('Copied public folder to dist/public');
    } catch (e) {
      console.log('No public folder to copy or copy failed', e);
    }
  },
});
