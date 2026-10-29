#!/usr/bin/env bash
set -euo pipefail
cd /work
mkdir guest-rootfs
tar -xf /inputs/guest-rootfs.tar -C guest-rootfs
truncate -s 6G guest.ext4
mkfs.ext4 -q -F -L moartube-arm64-qa -d guest-rootfs guest.ext4
e2fsck -fn guest.ext4
qemu-system-aarch64 --version
