#!/bin/bash
set -u
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/root
export DEBIAN_FRONTEND=noninteractive
mountpoint -q /proc || mount -t proc proc /proc
mountpoint -q /sys || mount -t sysfs sysfs /sys
mountpoint -q /dev || mount -t devtmpfs devtmpfs /dev
mountpoint -q /run || mount -t tmpfs tmpfs /run
mountpoint -q /tmp || mount -t tmpfs -o mode=1777 tmpfs /tmp
chmod 1777 /tmp
mkdir -p /dev/pts /dev/shm /run/dbus /host-output
mountpoint -q /dev/pts || mount -t devpts devpts /dev/pts
mountpoint -q /dev/shm || mount -t tmpfs -o mode=1777,nosuid,nodev,size=256M tmpfs /dev/shm
ln -snf /proc/self/fd /dev/fd
ln -snf /proc/self/fd/0 /dev/stdin
ln -snf /proc/self/fd/1 /dev/stdout
ln -snf /proc/self/fd/2 /dev/stderr
modprobe virtio_net || true
modprobe 9pnet_virtio || true
ip link set lo up
netdev="$(ls /sys/class/net | grep -v '^lo$' | head -1)"
if [ -n "$netdev" ]; then
  ip link set "$netdev" up
  ip addr add 10.0.2.15/24 dev "$netdev"
  ip route add default via 10.0.2.2
fi
printf 'nameserver 10.0.2.3\n' > /etc/resolv.conf
mount -t 9p -o trans=virtio,version=9p2000.L,msize=1048576 results /host-output
dbus-uuidgen --ensure=/etc/machine-id
dbus-daemon --system --fork
ulimit -c 0
echo 'MOARTUBE_ARM64_VM_BEGIN'
uname -a | tee /host-output/guest-kernel.txt
getconf PAGE_SIZE > /host-output/page-size.txt
for namespace in pid net user; do
  if unshare "--$namespace" --fork /bin/true; then
    echo "$namespace namespace: passed"
  else echo "$namespace namespace: failed"; fi
done | tee /host-output/namespaces.txt
cd /workspace
bash scripts/linux-installed-smoke.sh > /host-output/guest-tests.log 2>&1
code=$?
echo "MOARTUBE_ARM64_VM_TEST_EXIT=$code"
cp /qa/guest-packages.txt /host-output/guest-packages.txt
tar -czf /host-output/guest-evidence.tar.gz -C /workspace/build/desktop reports/linux-arm64 profiles/linux-arm64
printf '{"testExitCode":%s,"architecture":"arm64","execution":"full-system-qemu","sandboxDisabled":false}\n' "$code" > /host-output/status.json
sync
echo 'MOARTUBE_ARM64_VM_DONE'
/bin/busybox poweroff -f
