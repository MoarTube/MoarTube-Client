import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { linuxVariant } from '../../desktop/linux-variant.cjs';

export function writeLinuxReleaseNotes({ output, version, target, releaseBase, sourceUrl }) {
  for (const variant of ['client', 'bundled']) {
    const selected = linuxVariant(variant);
    const text =
      `# ${selected.productName} ${version} - ${target}\n\n` +
      `- [DEB installer](${releaseBase}/${selected.prefix}-${version}-${target}.deb)\n` +
      `- [Portable archive](${releaseBase}/${selected.prefix}-${version}-${target}-portable.tar.gz)\n` +
      `- [FFmpeg corresponding sources](${sourceUrl}) - optional\n` +
      `- [Checksums](${releaseBase}/SHA256SUMS-${target}-${variant}.txt)\n\n` +
      'Install the DEB using sudo apt install ./<download>.deb to resolve desktop dependencies. Electron supplies both backend runtimes; no standalone Node.js executable is included. Client JavaScript dependencies and shared bundles remain in ASAR. FFmpeg and FFprobe are included. GPU drivers are host prerequisites.\n\n' +
      (selected.bundled
        ? `MoarTube Node, Cloudflared, native SQLite and licenses are included. Matching application source and build materials are a separate optional download linked below. Connects only to its bundled Node. Automatic admin login is the default; save credentials in Settings to require login on the next start, or clear both fields to restore automatic login.\n\n`
        : 'Connect to a MoarTube Node managed separately using the normal login and Node selection.\n\n') +
      'Autostart and Minimize on Close default on, with synchronized File and tray menu controls. Disabling Minimize on Close makes closing quit and stop managed processes. Linux retains a minimized taskbar entry where tray support varies.\n\n' +
      (selected.bundled
        ? 'Data: MoarTube/client_node/client and MoarTube/client_node/node under the per-user data directory.\n\n'
        : 'Data: MoarTube/client under the per-user data directory.\n\n') +
      'Existing data in those folders is retained. Old folders are never imported. The portable archive requires the same system libraries and a working Chromium sandbox. Publish and retain the linked FFmpeg sources beside the binaries. Native GPU and Wayland qualification requires a physical desktop.\n';
    writeFileSync(path.join(output, `RELEASE-NOTES-${target}-${variant}.md`), text);
    if (variant === 'client') writeFileSync(path.join(output, `RELEASE-NOTES-${target}.md`), text);
  }
}
