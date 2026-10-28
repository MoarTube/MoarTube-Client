#!/usr/bin/env bash
set -euo pipefail
cd /workspace
arch="${MOARTUBE_DESKTOP_ARCH:-$(node -p process.arch)}"
case "$arch" in x64|arm64) ;; *) echo 'Unsupported architecture' >&2; exit 1 ;; esac
target="linux-$arch"
reports="build/desktop/reports/$target"
mkdir -p "$reports"
printf '#!/bin/sh\nprintf "existing npm CLI\\n"\n' > /tmp/moartube-cli-fixture
chmod 755 /tmp/moartube-cli-fixture
ln -s /tmp/moartube-cli-fixture /usr/bin/moartube-client
apt-get install -y --no-install-recommends ./MoarTube-Client-*-"$target".deb
test "$(readlink /usr/bin/moartube-client)" = /tmp/moartube-cli-fixture
test -f /usr/share/applications/moartube-client.desktop
grep -q '^StartupWMClass=moartube-client$' /usr/share/applications/moartube-client.desktop
test -f '/opt/MoarTube Client/resources/apparmor-profile'
test -s '/opt/MoarTube Client/resources/MoarTube-LICENSE.md'
apparmor_parser --skip-kernel-load --skip-read-cache '/opt/MoarTube Client/resources/apparmor-profile'
ldd '/opt/MoarTube Client/moartube-client-desktop' > "$reports/electron-ldd.txt"
if grep -q 'not found' "$reports/electron-ldd.txt"; then exit 1; fi
dpkg-query -W > "$reports/runtime-packages.txt"
printf '{"private":true,"type":"module"}\n' > package.json
npm install --ignore-scripts --no-audit --no-fund --save-exact playwright@1.64.1
mkdir -p /home/desktop-test/.config /home/desktop-test/.cache
mkdir -p /tmp/moartube-desktop-runtime
chmod 700 /tmp/moartube-desktop-runtime
chown desktop-test:desktop-test /tmp/moartube-desktop-runtime
backend_media="build/desktop/profiles/$target/backend-node/client/media/videos/install-preserve/keep.txt"
mkdir -p "$(dirname "$backend_media")"
printf 'preserve backend media\n' > "$backend_media"
chown -R desktop-test:desktop-test /workspace /home/desktop-test
# Validate packaged native modules and real backend separately from GUI support.
runuser -u desktop-test -- env HOME=/home/desktop-test \
  '/opt/MoarTube Client/resources/runtime/node' scripts/linux-backend-probe.cjs '/opt/MoarTube Client/resources'
cp "$reports/backend-probe.json" "$reports/installed-backend-probe.json"
# The container's namespace policy may require the setuid helper even though
# normal Ubuntu hosts use electron-builder's app-specific AppArmor integration.
chown root:root '/opt/MoarTube Client/chrome-sandbox'
chmod 4755 '/opt/MoarTube Client/chrome-sandbox'
gui_failed=0
if runuser -u desktop-test -- env HOME=/home/desktop-test XDG_RUNTIME_DIR=/tmp/moartube-desktop-runtime DEBUG=pw:browser* \
  dbus-run-session -- xvfb-run -a node scripts/desktop-smoke.mjs '/opt/MoarTube Client/moartube-client-desktop'; then
  cp "$reports/packaged/smoke.json" "$reports/installed-smoke.json"
  cp "$reports/packaged/window.png" "$reports/installed-window.png"
else gui_failed=1; fi
# Exercise the standalone distribution from a Unicode/space path as well.
portable='/workspace/portable QA Café 日本語'
mkdir -p "$portable"
tar -xzf ./MoarTube-Client-*-"$target".tar.gz -C "$portable"
portable_exe="$(find "$portable" -type f -name moartube-client-desktop -print -quit)"
test -n "$portable_exe"
chown -R desktop-test:desktop-test "$portable"
portable_sandbox="$(dirname "$portable_exe")/chrome-sandbox"
chown root:root "$portable_sandbox"
chmod 4755 "$portable_sandbox"
runuser -u desktop-test -- env HOME=/home/desktop-test \
  "$(dirname "$portable_exe")/resources/runtime/node" scripts/linux-backend-probe.cjs "$(dirname "$portable_exe")/resources"
cp "$reports/backend-probe.json" "$reports/portable-backend-probe.json"
if runuser -u desktop-test -- env HOME=/home/desktop-test XDG_RUNTIME_DIR=/tmp/moartube-desktop-runtime DEBUG=pw:browser* \
  dbus-run-session -- xvfb-run -a node scripts/desktop-smoke.mjs "$portable_exe"; then
  cp "$reports/packaged/smoke.json" "$reports/portable-smoke.json"
  cp "$reports/packaged/window.png" "$reports/portable-window.png"
else gui_failed=1; fi
# Reinstall the same candidate to exercise maintainer scripts and preserve data.
apt-get install --reinstall -y ./MoarTube-Client-*-"$target".deb
apt-get remove -y moartube-client
test -f "build/desktop/profiles/$target/backend-node/client/_client_settings.json"
grep -q 'preserve backend media' "$backend_media"
if [ "$gui_failed" = 0 ]; then
  test -f "build/desktop/profiles/$target/smoke-packaged/xdg/MoarTube Client/client/_client_settings.json"
  test -f "build/desktop/profiles/$target/smoke-packaged/xdg/MoarTube Client/client/media/videos/desktop-smoke-preserve/adaptive/keep.txt"
fi
test ! -e '/opt/MoarTube Client/moartube-client-desktop'
test "$(readlink /usr/bin/moartube-client)" = /tmp/moartube-cli-fixture
printf 'Install, backend launch, reinstall, uninstall and profile preservation passed.\n' > "$reports/installation-result.txt"
if [ "$gui_failed" != 0 ]; then
  printf 'Installed or portable graphical test failed; see console output. Backend/installer results do not qualify the renderer.\n' > "$reports/gui-result.txt"
  exit 1
fi
printf 'Installed and portable graphical checks passed with Chromium sandbox enabled.\n' > "$reports/gui-result.txt"
