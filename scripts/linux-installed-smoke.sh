#!/usr/bin/env bash
set -euo pipefail
cd /workspace
printf '#!/bin/sh\nprintf "existing npm CLI\\n"\n' > /tmp/moartube-cli-fixture
chmod 755 /tmp/moartube-cli-fixture
ln -s /tmp/moartube-cli-fixture /usr/bin/moartube-client
apt-get install -y --no-install-recommends ./MoarTube-Client-*-linux-x64.deb
test "$(readlink /usr/bin/moartube-client)" = /tmp/moartube-cli-fixture
test -f /usr/share/applications/moartube-client.desktop
grep -q '^StartupWMClass=moartube-client$' /usr/share/applications/moartube-client.desktop
test -f '/opt/MoarTube Client/resources/apparmor-profile'
test -s '/opt/MoarTube Client/resources/MoarTube-LICENSE.md'
apparmor_parser --skip-kernel-load --skip-read-cache '/opt/MoarTube Client/resources/apparmor-profile'
ldd '/opt/MoarTube Client/moartube-client-desktop' > build/desktop/electron-ldd.txt
if grep -q 'not found' build/desktop/electron-ldd.txt; then exit 1; fi
dpkg-query -W > build/desktop/runtime-packages.txt
printf '{"private":true,"type":"module"}\n' > package.json
npm install --ignore-scripts --no-audit --no-fund --save-exact playwright@1.64.1
mkdir -p /home/desktop-test/.config /home/desktop-test/.cache
mkdir -p /tmp/moartube-desktop-runtime
chmod 700 /tmp/moartube-desktop-runtime
chown desktop-test:desktop-test /tmp/moartube-desktop-runtime
chown -R desktop-test:desktop-test /workspace /home/desktop-test
# The container's namespace policy may require the setuid helper even though
# normal Ubuntu hosts use electron-builder's app-specific AppArmor integration.
chown root:root '/opt/MoarTube Client/chrome-sandbox'
chmod 4755 '/opt/MoarTube Client/chrome-sandbox'
runuser -u desktop-test -- env HOME=/home/desktop-test XDG_RUNTIME_DIR=/tmp/moartube-desktop-runtime \
  dbus-run-session -- xvfb-run -a node scripts/desktop-smoke.mjs '/opt/MoarTube Client/moartube-client-desktop'
cp build/desktop/packaged-smoke.json build/desktop/installed-smoke.json
cp build/desktop/packaged-window.png build/desktop/installed-window.png
# Exercise the standalone distribution from a Unicode/space path as well.
portable='/workspace/portable QA Café 日本語'
mkdir -p "$portable"
tar -xzf ./MoarTube-Client-*-linux-x64.tar.gz -C "$portable"
portable_exe="$(find "$portable" -type f -name moartube-client-desktop -print -quit)"
test -n "$portable_exe"
chown -R desktop-test:desktop-test "$portable"
portable_sandbox="$(dirname "$portable_exe")/chrome-sandbox"
chown root:root "$portable_sandbox"
chmod 4755 "$portable_sandbox"
runuser -u desktop-test -- env HOME=/home/desktop-test XDG_RUNTIME_DIR=/tmp/moartube-desktop-runtime \
  dbus-run-session -- xvfb-run -a node scripts/desktop-smoke.mjs "$portable_exe"
cp build/desktop/packaged-smoke.json build/desktop/portable-smoke.json
cp build/desktop/packaged-window.png build/desktop/portable-window.png
# Reinstall the same candidate to exercise maintainer scripts and preserve data.
apt-get install --reinstall -y ./MoarTube-Client-*-linux-x64.deb
apt-get remove -y moartube-client
test -f 'build/desktop/smoke-xdg/MoarTube Client/client/_client_settings.json'
test -f 'build/desktop/smoke-xdg/MoarTube Client/client/media/videos/desktop-smoke-preserve/adaptive/keep.txt'
test ! -e '/opt/MoarTube Client/moartube-client-desktop'
test "$(readlink /usr/bin/moartube-client)" = /tmp/moartube-cli-fixture
printf 'Install, launch, reinstall, uninstall and profile preservation passed.\n' > build/desktop/installation-result.txt
