import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { darwinVariant } from '../../desktop/darwin-variant.cjs';

export function writeDarwinReleaseNotes({ output, version, target, releaseBase, sourceUrl }) {
  const compressionLevel = process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ?? '6';
  for (const variant of ['client', 'bundled']) {
    const selected = darwinVariant(variant);
    const text =
      `# ${selected.productName} ${version} - ${target}, macOS 15+\n\n` +
      `- [Disk image](${releaseBase}/${selected.prefix}-${version}-${target}.dmg)\n` +
      `- [Application ZIP](${releaseBase}/${selected.prefix}-${version}-${target}.zip)\n` +
      `- [FFmpeg corresponding sources](${sourceUrl}) - optional\n` +
      `- [Checksums](${releaseBase}/SHA256SUMS-${target}-${variant}.txt)\n\n` +
      'Ad-hoc signed, not notarized. macOS may require manual approval of browser downloads. ' +
      'Electron supplies both backend runtimes; no standalone Node.js executable is included. ' +
      'Client dependencies and shared JavaScript remain in ASAR. FFmpeg and FFprobe are included. ' +
      (selected.bundled
        ? 'MoarTube Node JavaScript is stored in node.asar. Native SQLite, Cloudflared, logging workers, public assets and license notices retain disk paths. Matching Client + Node source/build materials are a separate optional download linked below. Connects only to its bundled Node. Automatic admin login is the default; save credentials in Settings to require login on the next start. Data is stored in ~/Library/Application Support/MoarTube/client_node/client and client_node/node.\n\n'
        : 'Connect to a separately managed MoarTube Node. Data is stored in ~/Library/Application Support/MoarTube/client.\n\n') +
      `ZIP uses Deflate level ${compressionLevel} and DMG uses UDZO compression level ${compressionLevel}. Autostart and Minimize on Close default on. Existing data is retained. Publish and retain matching sources beside the app. Physical Mac and VideoToolbox hardware qualification remain pending.\n`;
    writeFileSync(path.join(output, `RELEASE-NOTES-${target}-${variant}.md`), text);
    if (variant === 'client') writeFileSync(path.join(output, `RELEASE-NOTES-${target}.md`), text);
  }
}
