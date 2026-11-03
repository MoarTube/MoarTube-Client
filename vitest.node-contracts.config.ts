import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const clientRoot = dirname(fileURLToPath(import.meta.url));
const nodeRoot = resolve(clientRoot, '../MoarTube-Node');

// Each repository's source keeps its own aliases, including overlapping @/ imports.
export default defineConfig({
  plugins: [
    {
      name: 'moartube-repository-aliases',
      enforce: 'pre',
      resolveId(source, importer) {
        const match =
          /^(@|@config|@core|@database|@errors|@services|@controllers|@routes|@plugins|@utils|@validators|@websocket|@workers|@types)\/(.+)$/.exec(
            source
          );
        if (!match) return;
        const root = importer
          ?.replaceAll('\\', '/')
          .startsWith(nodeRoot.replaceAll('\\', '/') + '/')
          ? nodeRoot
          : clientRoot;
        const folder = match[1] === '@' ? '' : match[1]!.slice(1);
        const target = resolve(root, 'src', folder, match[2]!);
        const typescript = target.replace(/\.js$/, '.ts');
        return existsSync(typescript) ? typescript : target;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['tests/node-contracts/**/*.test.ts'],
  },
});
