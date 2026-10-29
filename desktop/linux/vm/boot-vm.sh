#!/usr/bin/env bash
set -euo pipefail
exec qemu-system-aarch64 \
  -machine virt,gic-version=3 -accel tcg,thread=multi -cpu cortex-a76 -smp 4 -m 4096 \
  -kernel /inputs/vmlinuz -initrd /inputs/initrd.img \
  -append 'console=ttyAMA0 root=/dev/vda rw rootwait noresume init=/qa/init.sh panic=30' \
  -drive file=/work/guest.ext4,format=raw,if=none,id=root -device virtio-blk-pci,drive=root \
  -netdev user,id=net -device virtio-net-pci,netdev=net,romfile= \
  -object rng-random,filename=/dev/urandom,id=rng -device virtio-rng-pci,rng=rng \
  -virtfs local,path=/results,mount_tag=results,security_model=none \
  -snapshot -nographic -monitor none -no-reboot
