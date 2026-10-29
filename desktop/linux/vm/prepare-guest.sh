#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update --error-on=any
cd /workspace
sha256sum -c asset-checksums.txt
apt-get install -y --no-install-recommends linux-image-arm64 initramfs-tools kmod iproute2 busybox dbus-system-bus-common ./MoarTube-Client-*-linux-arm64.deb
printf '{"private":true,"type":"module"}\n' > package.json
npm install --ignore-scripts --no-audit --no-fund --save-exact playwright@1.64.1
mkdir -p /qa /host-output /workspace/build/desktop/reports/linux-arm64 /workspace/build/desktop/profiles/linux-arm64
cp /workspace/guest-init.sh /qa/init.sh
chmod 755 /qa/init.sh
dpkg-query -W > /qa/guest-packages.txt
node --version > /qa/node-version.txt
find /boot -maxdepth 1 -type f -printf '%f\n'
