import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { desktopPaths } from '../tooling/build-paths.cjs';
import { parseLinuxDesktopArgs } from '../desktop/linux-variant.cjs';

export function verifyLinuxCoexist({ root, arch, version, image }) {
  const release = desktopPaths(root, `linux-${arch}`, version).release;
  const script = `set -eu
    data=/home/desktop-test/.local/share/MoarTube
    mkdir -p "$data/client" "$data/client_node/client" "$data/client_node/node"
    for directory in "$data/client" "$data/client_node/client" "$data/client_node/node"; do printf 'keep' > "$directory/preserve.txt"; done
    printf '#!/bin/sh\\nexit 0\\n' > /tmp/existing-cli
    chmod 755 /tmp/existing-cli
    ln -s /tmp/existing-cli /usr/bin/moartube-client
    dpkg --install /downloads/MoarTube-Client-${version}-linux-${arch}.deb /downloads/MoarTube-Client-Node-${version}-linux-${arch}.deb
    test -x '/opt/MoarTube Client/moartube-client-desktop'
    test -x '/opt/MoarTube Client + Node/moartube-client-node-desktop'
    test -f /usr/share/applications/moartube-client.desktop
    test -f /usr/share/applications/moartube-client-node.desktop
    dpkg --remove moartube-client
    test -x '/opt/MoarTube Client + Node/moartube-client-node-desktop'
    test -f /usr/share/applications/moartube-client-node.desktop
    dpkg --remove moartube-client-node
    for directory in "$data/client" "$data/client_node/client" "$data/client_node/node"; do test "$(cat "$directory/preserve.txt")" = keep; done
    test "$(readlink /usr/bin/moartube-client)" = /tmp/existing-cli
    echo 'Client and Client + Node coexist; independent removal preserves all data and the existing npm CLI.'
  `;
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--mount',
      `type=bind,source=${release},target=/downloads,readonly`,
      image,
      'bash',
      '-c',
      script,
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true }
  );
  if (result.error || result.status !== 0)
    throw result.error ?? new Error('Linux coexistence verification failed');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { arch } = parseLinuxDesktopArgs(process.argv.slice(2));
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  verifyLinuxCoexist({ root, arch, version, image: `moartube-desktop-runtime-${arch}:24.04` });
}
